/**
 * Historical import from the terminal (Phase 2). Safe to run again and again: rows that are already in
 * the ledger are skipped, so a second run inserts nothing and only re-checks the numbers.
 *
 *   pnpm import:run                 import (writes docs/IMPORT_REPORT.md)
 *   pnpm import:dry-run             read, check and rehearse the load, then roll everything back
 *   pnpm import:run --user you@x    record the run under a specific user (default: the Owner)
 *   pnpm import:run --source-dir D  where the two workbooks live (default: data/source)
 *   pnpm import:run --no-report     do not write docs/IMPORT_REPORT.md
 *
 * Uses the app's restricted database role when APP_DATABASE_URL is set (the same grants the app has).
 */
import "dotenv/config";
import path from "node:path";
import { createPrismaClient, runtimeDatabaseUrl } from "../../src/lib/db";
import { runImport } from "../../src/lib/import/run";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]?.startsWith("--")
    ? (process.argv[i + 1] as string)
    : null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const noReport = process.argv.includes("--no-report");
  const sourceDir = arg("--source-dir") ?? path.join(process.cwd(), "data", "source");
  const email = arg("--user");
  const db = createPrismaClient(runtimeDatabaseUrl());
  try {
    const user = email
      ? await db.user.findUnique({ where: { email: email.trim().toLowerCase() } })
      : await db.user.findFirst({
          where: { role: "OWNER", isActive: true },
          orderBy: { createdAt: "asc" },
        });
    if (!user) {
      console.error(
        email
          ? `No user has the email ${email}.`
          : "No active Owner user exists yet. Run the seed (pnpm db:seed) or pass --user <email>.",
      );
      process.exit(1);
    }
    console.log(
      `Historical import${dryRun ? " (DRY RUN — nothing will be kept)" : ""} as ${user.displayName} <${user.email}> from ${sourceDir}`,
    );
    const t0 = Date.now();
    const outcome = await runImport(db, {
      sourceDir,
      dryRun,
      actor: {
        userId: user.id,
        sessionId: null,
        ip: null,
        userAgent: "scripts/import/run.ts",
        displayName: user.displayName,
      },
      trigger: "cli",
      reportPath: noReport ? null : path.join(process.cwd(), "docs", "IMPORT_REPORT.md"),
      log: (line) => console.log(line),
    });
    const s = outcome.summary;
    const all = [...s.checks.preA, ...s.checks.preB, ...s.checks.models, ...s.checks.db];
    const failed = all.filter((c) => !c.ok);
    console.log("");
    console.log(
      `${outcome.status}${dryRun ? " (dry run, rolled back)" : ""} in ${((Date.now() - t0) / 1000).toFixed(1)} s — run ${outcome.runId}`,
    );
    console.log(
      `Inserted: 2019–2024 ${s.load.a.inserted} (skipped ${s.load.a.existing}) · 2025 ${s.load.b.inserted} (skipped ${s.load.b.existing}) · reference models ${s.load.models.inserted} (skipped ${s.load.models.existing})`,
    );
    console.log(
      `Checks: ${all.length - failed.length}/${all.length} pass${failed.length ? ` — ${failed.filter((c) => c.critical).length} critical, ${failed.filter((c) => !c.critical).length} informational failures:` : ""}`,
    );
    for (const c of failed)
      console.log(
        `  ${c.critical ? "❌" : "ℹ️ "} [${c.group}] ${c.label}: expected ${c.expected}, found ${c.actual}${c.note ? ` — ${c.note}` : ""}`,
      );
    if (!noReport && !dryRun)
      console.log("Report written to docs/IMPORT_REPORT.md (also shown in Settings → Data).");
    if (outcome.status === "FAILED") {
      console.error(`\n${s.error ?? "The import stopped."}`);
      process.exit(2);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
