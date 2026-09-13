/**
 * Break-glass: set a user's password from the Terminal, for when nobody who can sign in is available
 * (forgotten Owner password, first-day typos, a lost phone AND lost recovery codes).
 *
 *   pnpm user:set-password <email> "<new password>"
 *
 * Uses the owner database connection from .env. Clears any lock, ends the user's open sessions, and
 * writes an audit row. The password must be 12+ characters with upper- and lower-case letters and a number.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword, passwordProblems } from "../src/lib/auth/password";

async function main() {
  const [emailArg, password] = process.argv.slice(2);
  if (!emailArg || !password) {
    console.error('Usage: pnpm user:set-password <email> "<new password>"');
    process.exit(1);
  }
  const problems = passwordProblems(password);
  if (problems.length) {
    console.error(`That password needs ${problems.join(", ")}.`);
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
    process.exit(1);
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const email = emailArg.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`No user has the email ${email}.`);
      process.exit(1);
    }
    const passwordHash = await hashPassword(password);
    const ended = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      });
      const revoked = await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "password set from the terminal" },
      });
      await tx.auditLog.create({
        data: {
          action: "user.password_reset",
          subjectType: "user",
          subjectId: user.id,
          subjectLabel: user.email,
          reason: "set from the terminal (scripts/set-password.ts)",
          after: { sessionsEnded: revoked.count, lockCleared: true },
        },
      });
      return revoked.count;
    });
    console.log(
      `Password updated for ${user.email}. Any lock was cleared and ${ended} open session(s) were ended.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
