/**
 * Historical import from the terminal (Phase 2). Safe to run again and again: rows that are already in
 * the ledger are skipped, so a second run inserts nothing and only re-checks the numbers.
 *
 *   pnpm import:run --user you@example.com        import; writes docs/IMPORT_REPORT.md when something changed
 *   pnpm import:dry-run --user you@example.com    read, check and rehearse the load, then roll everything back
 *   --source-dir /folder                          where the two workbooks live (default: IMPORT_SOURCE_DIR or data/source)
 *   --allow-filed                                 allow new rows into a closed/filed year other than 2019–2024
 *   --report always | never                       always write the report file, or never (default: when something changed)
 *
 * The run, the audit row and every imported transaction are recorded under --user (an active Owner or
 * Full-access user), so pass the person who is actually doing it. Uses the app's restricted database
 * role when APP_DATABASE_URL is set (the same grants the app has).
 */
import "dotenv/config";
import path from "node:path";
import { createPrismaClient, runtimeDatabaseUrl } from "../../src/lib/db";
import { importSourceDir } from "../../src/lib/import/paths";
import { runImport } from "../../src/lib/import/run";
import { checksSentence, checksSummary } from "../../src/lib/import/status";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]?.startsWith("--")
    ? (process.argv[i + 1] as string)
    : null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const allowLockedYears = process.argv.includes("--allow-filed");
  const reportArg = arg("--report");
  const sourceDir = arg("--source-dir") ?? importSourceDir();
  const email = arg("--user");
  const db = createPrismaClient(runtimeDatabaseUrl());
  try {
    const eligible = await db.user.findMany({
      where: { isActive: true, role: { in: ["OWNER", "FULL"] } },
      select: { email: true, displayName: true, role: true },
      orderBy: { email: "asc" },
    });
    if (!email) {
      console.error("Say who is running the import: pnpm import:run --user <email>");
      console.error(
        `Active Owner / Full-access users: ${eligible.map((u) => `${u.email} (${u.displayName})`).join(", ") || "none — run the seed first"}.`,
      );
      process.exit(1);
    }
    const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user) {
      console.error(
        `No user has the email ${email}. Active Owner / Full-access users: ${eligible.map((u) => u.email).join(", ") || "none"}.`,
      );
      process.exit(1);
    }
    if (!user.isActive || (user.role !== "OWNER" && user.role !== "FULL")) {
      console.error(
        `${user.email} cannot run the import: it needs an active Owner or Full-access user (this one is ${user.isActive ? user.role.toLowerCase() : "deactivated"}).`,
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
      allowLockedYears,
      actor: {
        userId: user.id,
        sessionId: null,
        ip: null,
        userAgent: "scripts/import/run.ts",
        displayName: user.displayName,
      },
      trigger: "cli",
      reportPath:
        reportArg === "never" ? null : path.join(process.cwd(), "docs", "IMPORT_REPORT.md"),
      reportPolicy: reportArg === "always" ? "always" : "when-changed",
      log: (line) => console.log(line),
    });
    const s = outcome.summary;
    const all = [...s.checks.preA, ...s.checks.preB, ...s.checks.models, ...s.checks.db];
    const failed = all.filter((c) => !c.ok);
    const summary = checksSummary(s);
    console.log("");
    console.log(
      `${outcome.status}${dryRun ? " (dry run, rolled back)" : ""} in ${((Date.now() - t0) / 1000).toFixed(1)} s — run ${outcome.runId}`,
    );
    console.log(
      `Added: 2019–2024 ${s.load.a.inserted} (already there ${s.load.a.existing}) · 2025 ${s.load.b.inserted} (already there ${s.load.b.existing}) · reference models ${s.load.models.inserted} (already there ${s.load.models.existing})`,
    );
    console.log(`Checks: ${summary ? checksSentence(summary) : "—"}${failed.length ? ":" : ""}`);
    for (const c of failed)
      console.log(
        `  ${c.critical ? "❌" : "ℹ️ "} [${c.group}] ${c.label}: expected ${c.expected}, found ${c.actual}${c.note ? ` — ${c.note}` : ""}`,
      );
    if (outcome.reportFileWritten)
      console.log(
        "Report written to docs/IMPORT_REPORT.md (every run's report is also in Settings → Data).",
      );
    else if (!dryRun && outcome.status === "SUCCEEDED")
      console.log(
        "Nothing changed, so docs/IMPORT_REPORT.md was left as it is; this run's report is in Settings → Data (pass --report always to write the file anyway).",
      );
    if (outcome.reportFileWarning) console.log(`Warning: ${outcome.reportFileWarning}`);
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
