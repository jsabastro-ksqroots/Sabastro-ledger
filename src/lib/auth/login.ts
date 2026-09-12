import type { DbOrTx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dummyHash, verifyPassword } from "@/lib/auth/password";
import { createSession, type RequestMeta } from "@/lib/auth/session";
import {
  clearFailures,
  ipIsThrottled,
  recordAttempt,
  registerFailure,
  secondsUntil,
} from "@/lib/auth/lockout";

export type LoginResult =
  | { ok: true; token: string; sessionId: string; userId: string; needsEnrollment: boolean }
  | {
      ok: false;
      reason: "invalid" | "locked" | "throttled" | "inactive";
      retryAfterSeconds?: number;
    };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Step 1 of signing in: email + password. On success the session is "half open" until MFA passes. */
export async function loginWithPassword(
  tx: DbOrTx,
  input: { email: string; password: string } & RequestMeta,
  now = new Date(),
): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  const meta: RequestMeta = { ip: input.ip ?? null, userAgent: input.userAgent ?? null };

  if (await ipIsThrottled(tx, meta.ip, now)) {
    await recordAttempt(tx, email, meta.ip, false);
    await audit(tx, {
      action: "login.throttled",
      subjectType: "email",
      subjectLabel: email,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { ok: false, reason: "throttled", retryAfterSeconds: 15 * 60 };
  }

  const user = await tx.user.findUnique({ where: { email } });

  if (user?.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    await recordAttempt(tx, email, meta.ip, false);
    await audit(tx, {
      action: "login.locked",
      userId: user.id,
      subjectType: "user",
      subjectId: user.id,
      subjectLabel: email,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { ok: false, reason: "locked", retryAfterSeconds: secondsUntil(user.lockedUntil, now) };
  }

  const passwordOk = user
    ? await verifyPassword(user.passwordHash, input.password)
    : await verifyPassword(await dummyHash(), input.password).then(() => false);

  if (!user) {
    await recordAttempt(tx, email, meta.ip, false);
    await audit(tx, {
      action: "login.failed",
      subjectType: "email",
      subjectLabel: email,
      after: { reason: "unknown email" },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { ok: false, reason: "invalid" };
  }

  if (!passwordOk) {
    const { lockedUntil } = await registerFailure(tx, user, "password", meta, now);
    if (lockedUntil)
      return { ok: false, reason: "locked", retryAfterSeconds: secondsUntil(lockedUntil, now) };
    return { ok: false, reason: "invalid" };
  }

  if (!user.isActive) {
    await recordAttempt(tx, email, meta.ip, false);
    await audit(tx, {
      action: "login.inactive",
      userId: user.id,
      subjectType: "user",
      subjectId: user.id,
      subjectLabel: email,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { ok: false, reason: "inactive" };
  }

  await clearFailures(tx, user.id, now);
  await recordAttempt(tx, email, meta.ip, true);
  const { token, sessionId } = await createSession(tx, user.id, meta, { mfaVerified: false });
  await audit(tx, {
    action: "login.password_ok",
    userId: user.id,
    sessionId,
    subjectType: "user",
    subjectId: user.id,
    subjectLabel: email,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return { ok: true, token, sessionId, userId: user.id, needsEnrollment: !user.mfaEnrolledAt };
}
