import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Prisma } from "@/generated/prisma/client";
import type { Db, DbOrTx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { findLockedYears, type YearPair } from "@/lib/ledger/locks";
import { SEED_TAX_YEARS } from "@/lib/seed/seed-data";
import { formatCents } from "@/lib/money";
import {
  checksForWorkbookA,
  checksForWorkbookB,
  isCrossEntityRow,
  loadSeedChart,
  sameDayGroups,
  summarise,
  TARGET_B,
  type SeedChart,
} from "./checklist";
import {
  buildLookups,
  existingSourceRefs,
  insertPrepared,
  LOCK_OVERRIDE_REASON,
  prepareEntryA,
  prepareRowB,
  setLockOverride,
  type ImportActor,
  type Lookups,
  type PreparedTransaction,
} from "./load";
import { sourcePaths } from "./paths";
import {
  checkPercentageSet,
  checkSpecificBills,
  loadReferenceModelFiles,
  modelNamesFor,
  PERSONAL_TARGET,
  referenceModelDir,
  referenceModelNote,
  sharesToBasisPoints,
  UMBRELLA_TARGET,
  verifyReferenceModelAgainstWorkbook,
  type ReferenceModelFile,
} from "./reference-models";
import { renderReport, type ImportSummary } from "./report";
import { checksFromDatabase } from "./verify-db";
import { extractWorkbookA } from "./workbook-a";
import { extractWorkbookB } from "./workbook-b";
import { openWorkbook } from "./xlsx";
import {
  cents,
  SOURCE_A,
  SOURCE_B,
  type Check,
  type WorkbookAExtract,
  type WorkbookBExtract,
} from "./types";

/**
 * The historical import, end to end (KICKOFF_PROMPTS.md Phase 2):
 *
 *   1. read both workbooks and the transcribed reference models;
 *   2. reproduce the acceptance checklist from what was read — a critical miss stops here, nothing is
 *      written, and the report shows the difference;
 *   3. inside ONE database transaction: tax-year states, the transactions that are not there yet
 *      (idempotent on source file + source row), the reference models, then the same checklist read back
 *      from the database; a miss rolls everything back. Filed years are written under the lock override
 *      only when the run really touches them, and only the seed's history years (2019–2024) without an
 *      explicit go-ahead;
 *   4. one audit row for the run, an import_runs row, and the report (Settings → Data; the Terminal
 *      also writes docs/IMPORT_REPORT.md when something changed).
 *
 * Running it again is a no-op: every source row is already present, so 0 rows are inserted, and the
 * database checks become a re-check that tolerates bookkeeping done since the import.
 */

export interface ImportOptions {
  sourceDir: string;
  modelsDir?: string;
  dryRun: boolean;
  actor: ImportActor & { displayName: string };
  trigger: "cli" | "app";
  /** Where to write the Markdown report file; null to skip it (the database keeps a copy of every run). */
  reportPath: string | null;
  /** "when-changed" (default): write the file only when the run inserted something, stopped, or the file is missing. */
  reportPolicy?: "always" | "when-changed";
  /**
   * Allow new posted rows into closed/filed years other than the seed's history years (SREI 2019–2024,
   * which the initial load must write). Default false: such a run stops before writing anything.
   */
  allowLockedYears?: boolean;
  log?: (line: string) => void;
}

export interface ImportOutcome {
  runId: string;
  status: "SUCCEEDED" | "FAILED";
  dryRun: boolean;
  summary: ImportSummary;
  report: string;
  allChecksPassed: boolean;
  reportFileWritten: boolean;
  reportFileWarning: string | null;
}

/** How long a run may show as "running" before it is treated as interrupted. */
export const STALE_RUN_MS = 60 * 60_000;

class ImportStopped extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportStopped";
  }
}
class DryRunRollback extends Error {
  constructor() {
    super("dry run");
    this.name = "DryRunRollback";
  }
}

export { sourcePaths };

function critical(checks: Check[]): Check[] {
  return checks.filter((c) => !c.ok && c.critical);
}

function plainError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/Unique constraint failed/.test(message) || /P2002/.test(message))
    return "Another import wrote the same source rows first (two imports ran at once). Nothing was written by this run; run it again.";
  return message.replace(/\s+/g, " ").trim();
}

export async function runImport(db: Db, opts: ImportOptions): Promise<ImportOutcome> {
  const log = opts.log ?? (() => {});
  const startedAt = new Date();
  const paths = sourcePaths(opts.sourceDir);
  for (const p of paths) {
    if (!existsSync(p.path))
      throw new ImportStopped(
        `The source workbook is missing: ${p.path}. Put the two workbooks named in DATA_SOURCES.md into ${opts.sourceDir} and run again.`,
      );
  }
  const modelsDir = opts.modelsDir ?? referenceModelDir();

  // 1. Read everything.
  log("Reading the 2019–2024 workbook…");
  const a = await extractWorkbookA((paths[0] as { path: string }).path);
  log(
    `  ${a.lines.length.toLocaleString("en-US")} lines, ${a.entries.length.toLocaleString("en-US")} transactions`,
  );
  log("Reading the 2025 snapshot…");
  const b = await extractWorkbookB((paths[1] as { path: string }).path);
  log(`  ${b.rows.length} rows`);
  const modelFiles = loadReferenceModelFiles(modelsDir);
  log(`Reference model files: ${modelFiles.map((m) => m.year).join(", ") || "none"}`);
  const chart = loadSeedChart();

  // 2. Checks before anything is written.
  const preA = checksForWorkbookA(a, chart);
  const preB = checksForWorkbookB(b, chart);
  const modelChecks: Check[] = [];
  const wbA = await openWorkbook((paths[0] as { path: string }).path);
  const modelVerification = new Map<
    number,
    { checked: number; mismatches: string[]; nonEmptyCells: number; accountedFor: number }
  >();
  for (const mf of modelFiles) {
    const v = verifyReferenceModelAgainstWorkbook(wbA, mf);
    const mismatches = v.mismatches.map(
      (m) => `${m.cell} (${m.where}): JSON ${m.expected} vs sheet ${m.found}`,
    );
    const accountedFor = mf.coverage?.accountedFor ?? 0;
    const nonEmptyCells = mf.coverage?.nonEmptyCells ?? 0;
    const unaccounted = mf.coverage?.unaccounted ?? [];
    modelVerification.set(mf.year, { checked: v.checked, mismatches, nonEmptyCells, accountedFor });
    modelChecks.push({
      group: "Reference models",
      label: `${mf.year}: transcribed numbers match the worksheet cells (${v.checked} checked)`,
      expected: "0 mismatches",
      actual: `${mismatches.length} mismatch${mismatches.length === 1 ? "" : "es"}`,
      ok: mismatches.length === 0,
      critical: true,
      note: mismatches.slice(0, 5).join("; "),
    });
    for (const set of mf.percentageSets) {
      const problems = checkPercentageSet(set);
      modelChecks.push({
        group: "Reference models",
        label: `${mf.year} · ${set.label}: shares total 100 % and follow the weights`,
        expected: "ok",
        actual: problems.length ? problems.join("; ") : "ok",
        ok: problems.length === 0,
        critical: true,
      });
    }
    const billProblems = checkSpecificBills(mf);
    modelChecks.push({
      group: "Reference models",
      label: `${mf.year}: each allocated bill is its percentage set applied to its total`,
      expected: "ok",
      actual: billProblems.length ? billProblems.join("; ") : "ok",
      ok: billProblems.length === 0,
      critical: true,
    });
    modelChecks.push({
      group: "Reference models",
      label: `${mf.year}: every non-empty worksheet cell is accounted for (the transcription's own count)`,
      expected: `${nonEmptyCells} cells`,
      actual:
        accountedFor === nonEmptyCells && unaccounted.length === 0
          ? `${nonEmptyCells} cells`
          : `${accountedFor} accounted for, ${unaccounted.length} unaccounted${unaccounted.length ? ` (${unaccounted.slice(0, 8).join(", ")})` : ""}`,
      ok: accountedFor === nonEmptyCells && unaccounted.length === 0,
      critical: false,
      note: "Documentation only: the numbers themselves are verified cell by cell above.",
    });
  }
  modelChecks.push({
    group: "Reference models",
    label: "Worksheet years transcribed",
    expected: "2020, 2021, 2022, 2023, 2024",
    actual:
      modelFiles
        .map((m) => m.year)
        .sort()
        .join(", ") || "none",
    ok: [2020, 2021, 2022, 2023, 2024].every((y) => modelFiles.some((m) => m.year === y)),
    critical: true,
  });
  const preCritical = [...critical(preA), ...critical(preB), ...critical(modelChecks)];
  const s = { a: summarise(preA), b: summarise(preB), m: summarise(modelChecks) };
  log(
    `Checks before writing: 2019–2024 ${s.a.total - s.a.failed}/${s.a.total} · 2025 ${s.b.total - s.b.failed}/${s.b.total} · models ${s.m.total - s.m.failed}/${s.m.total}`,
  );

  // Run bookkeeping: a run the app never finished is marked interrupted; only one run at a time.
  await db.importRun.updateMany({
    where: { status: "RUNNING", startedAt: { lt: new Date(startedAt.getTime() - STALE_RUN_MS) } },
    data: {
      status: "FAILED",
      finishedAt: startedAt,
      error: "Interrupted: the app stopped before this run finished. Nothing it wrote was kept.",
    },
  });
  const live = await db.importRun.findFirst({
    where: { status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });
  if (live) {
    const minutes = Math.max(
      1,
      Math.round((startedAt.getTime() - live.startedAt.getTime()) / 60_000),
    );
    throw new ImportStopped(
      `An import started ${minutes} minute${minutes === 1 ? "" : "s"} ago is still running. Wait for it to finish, then try again.`,
    );
  }
  const run = await db.importRun.create({
    data: {
      startedAt,
      status: "RUNNING",
      dryRun: opts.dryRun,
      trigger: opts.trigger,
      runById: opts.actor.userId,
      sources: paths.map((p) => ({
        key: p.key,
        file: p.file,
        sha256: p.key === "A" ? a.sha256 : b.sha256,
        bytes: statSync(p.path).size,
      })) as Prisma.InputJsonValue,
    },
  });

  const base = baseSummary(
    run.id,
    startedAt,
    opts,
    paths,
    a,
    b,
    chart,
    preA,
    preB,
    modelChecks,
    modelFiles,
    modelVerification,
  );
  let finished = false;

  const finish = async (
    status: "SUCCEEDED" | "FAILED",
    partial: Partial<ImportSummary>,
    error: string | null,
  ): Promise<ImportOutcome> => {
    const finishedAt = new Date();
    const summary: ImportSummary = {
      ...base,
      ...partial,
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      outcome: status === "FAILED" ? "FAILED" : opts.dryRun ? "DRY_RUN" : "SUCCEEDED",
      error,
    };
    const inserted =
      summary.load.a.inserted + summary.load.b.inserted + summary.load.models.inserted;
    let reportFileWritten = false;
    let reportFileWarning: string | null = null;
    const policy = opts.reportPolicy ?? "when-changed";
    const wantFile =
      !!opts.reportPath &&
      !opts.dryRun &&
      (policy === "always" || status === "FAILED" || inserted > 0 || !existsSync(opts.reportPath));
    const report = renderReport(summary);
    if (wantFile && opts.reportPath) {
      try {
        mkdirSync(path.dirname(opts.reportPath), { recursive: true });
        writeFileSync(opts.reportPath, report);
        reportFileWritten = true;
      } catch (err) {
        reportFileWarning = `The report could not be written to ${opts.reportPath} (${plainError(err)}). It is still available in Settings → Data.`;
        log(reportFileWarning);
      }
    }
    summary.reportFileWarning = reportFileWarning;
    const allChecksPassed =
      [
        ...summary.checks.preA,
        ...summary.checks.preB,
        ...summary.checks.models,
        ...summary.checks.db,
      ].filter((c) => !c.ok && c.critical).length === 0;
    await db.importRun.update({
      where: { id: run.id },
      data: {
        finishedAt,
        status,
        summary: JSON.parse(JSON.stringify(summary)) as Prisma.InputJsonValue,
        allChecksPassed,
        reportMarkdown: renderReport(summary),
        error,
      },
    });
    finished = true;
    if (opts.dryRun || status === "FAILED") {
      await audit(db, {
        action: opts.dryRun ? "import.dry_run" : "import.failed",
        userId: opts.actor.userId,
        sessionId: opts.actor.sessionId,
        subjectType: "import_run",
        subjectId: run.id,
        subjectLabel: `historical import (${opts.trigger})`,
        after: { status, allChecksPassed, inserted: summary.load, error },
        ip: opts.actor.ip ?? null,
        userAgent: opts.actor.userAgent ?? null,
      });
    }
    return {
      runId: run.id,
      status,
      dryRun: opts.dryRun,
      summary,
      report: renderReport(summary),
      allChecksPassed,
      reportFileWritten,
      reportFileWarning,
    };
  };

  try {
    if (preCritical.length > 0) {
      const msg = `${preCritical.length} critical check${preCritical.length === 1 ? "" : "s"} failed before anything was written: ${preCritical
        .slice(0, 3)
        .map((c) => `${c.label} (expected ${c.expected}, found ${c.actual})`)
        .join("; ")}${preCritical.length > 3 ? "; …" : ""}. Nothing was changed.`;
      log(msg);
      return await finish("FAILED", {}, msg);
    }

    // 3. Write, verify, commit (or roll back).
    let result: { partial: Partial<ImportSummary>; error: string | null } | null = null;
    try {
      await db.$transaction(
        async (tx) => {
          const lk = await buildLookups(tx);
          const now = new Date();

          // Tax-year states (kickoff item 4): create what is missing, never move a state backwards.
          const taxYears = await ensureTaxYearStates(tx, lk, opts.actor, now);

          // Transactions that are not there yet.
          const haveA = await existingSourceRefs(tx, SOURCE_A);
          const haveB = await existingSourceRefs(tx, SOURCE_B);
          const preparedA: PreparedTransaction[] = [];
          for (const e of a.entries) {
            if (haveA.has(String(e.txn))) continue;
            preparedA.push(prepareEntryA(e, lk, opts.actor, now));
          }
          const dupOf = new Map<number, number[]>();
          for (const g of sameDayGroups(b.rows))
            for (const r of g)
              dupOf.set(
                r.ref,
                g.filter((x) => x.ref !== r.ref).map((x) => x.ref),
              );
          const preparedB: PreparedTransaction[] = [];
          for (const r of b.rows) {
            if (haveB.has(String(r.ref))) continue;
            preparedB.push(
              prepareRowB(r, lk, opts.actor, now, { duplicatesOf: dupOf.get(r.ref) ?? [] }),
            );
          }

          // Closed or filed years the new rows would land in. The initial load must write the seed's
          // history years; anything else needs an explicit go-ahead.
          const pairs: YearPair[] = [...preparedA, ...preparedB]
            .filter((p) => p.header.status === "POSTED" || p.header.status === "VOIDED")
            .flatMap((p) => {
              const year = (p.header.date as Date).getUTCFullYear();
              const entities = new Set<string>([
                p.header.entityId as string,
                ...p.lines.map((l) => l.entityId).filter((x): x is string => !!x),
              ]);
              return [...entities].map((entityId) => ({ entityId, year }));
            });
          const locked = await findLockedYears(tx, pairs);
          const historyYears = new Set(
            SEED_TAX_YEARS.filter((t) => t.state === "FILED").map(
              (t) => `${lk.entityByCode.get(t.entityCode)}:${t.year}`,
            ),
          );
          const notAllowed = locked.filter((y) => !historyYears.has(`${y.entityId}:${y.year}`));
          if (notAllowed.length > 0 && !opts.allowLockedYears) {
            const rowsPerYear = notAllowed.map((y) => {
              const n = pairs.filter((p) => p.entityId === y.entityId && p.year === y.year).length;
              return `${y.entityCode} ${y.year} (${y.state.toLowerCase()}, ${n} new row${n === 1 ? "" : "s"})`;
            });
            throw new ImportStopped(
              `New rows would land in a closed or filed year: ${rowsPerYear.join("; ")}. Nothing was written. Re-open the year, or run the import from the Terminal with --allow-filed after confirming with Jose.`,
            );
          }
          if (locked.length > 0) await setLockOverride(tx, LOCK_OVERRIDE_REASON);
          const lockedYearsTouched = locked.map(
            (y) => `${y.entityCode} ${y.year} (${y.state.toLowerCase()})`,
          );

          log(
            `Writing ${preparedA.length.toLocaleString("en-US")} + ${preparedB.length} transactions (${haveA.size.toLocaleString("en-US")} + ${haveB.size} already present)…`,
          );
          await insertPrepared(tx, preparedA, (done, total) =>
            log(`  2019–2024: ${done}/${total}`),
          );
          await insertPrepared(tx, preparedB, (done, total) => log(`  2025: ${done}/${total}`));

          // Reference models.
          const models = await insertReferenceModels(tx, lk, modelFiles, opts.actor, now);
          log(`Reference models: ${models.inserted} archived, ${models.existing} already present`);

          // Fire the deferred balance and share triggers now, so a dry run exercises them too.
          await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

          // Read the checklist back from the database.
          const bridgedRowsB = b.rows.filter(isCrossEntityRow).length;
          const kindsA = { BANK: 0, JOURNAL: 0, ADJUSTING: 0 };
          for (const e of a.entries) if (!e.isVoidPlaceholder) kindsA[e.kind]++;
          const wrote = {
            a: { inserted: preparedA.length, existing: haveA.size },
            b: { inserted: preparedB.length, existing: haveB.size },
          };
          const dbChecks = await checksFromDatabase(tx, {
            bridgedRowsB,
            kindsA,
            referenceModelsPerYear: Object.fromEntries(
              modelFiles.map((m) => [m.year, m.percentageSets.length]),
            ),
            wrote,
          });
          const failed = critical(dbChecks);
          const partial: Partial<ImportSummary> = {
            checks: { ...base.checks, db: dbChecks },
            load: { a: wrote.a, b: wrote.b, models, lockedYearsTouched },
            taxYears,
          };
          if (failed.length > 0) {
            result = {
              partial,
              error: `${failed.length} check${failed.length === 1 ? "" : "s"} read back from the database did not tie: ${failed
                .slice(0, 3)
                .map((c) => `${c.label} (expected ${c.expected}, found ${c.actual})`)
                .join("; ")}. Everything was rolled back.`,
            };
            throw new ImportStopped(result.error as string);
          }
          await audit(tx, {
            action: "import.run",
            userId: opts.actor.userId,
            sessionId: opts.actor.sessionId,
            subjectType: "import_run",
            subjectId: run.id,
            subjectLabel: `historical import (${opts.trigger})`,
            reason: locked.length ? LOCK_OVERRIDE_REASON : null,
            isLockOverride: locked.length > 0,
            after: {
              inserted: {
                workbookA: preparedA.length,
                workbookB: preparedB.length,
                referenceModels: models.inserted,
              },
              skipped: {
                workbookA: haveA.size,
                workbookB: haveB.size,
                referenceModels: models.existing,
              },
              lockedYearsTouched,
              sources: base.sources.map((x) => ({ file: x.file, sha256: x.sha256 })),
            },
            ip: opts.actor.ip ?? null,
            userAgent: opts.actor.userAgent ?? null,
          });
          result = { partial, error: null };
          if (opts.dryRun) throw new DryRunRollback();
        },
        { timeout: 30 * 60_000, maxWait: 60_000 },
      );
    } catch (err) {
      const r = result as { partial: Partial<ImportSummary>; error: string | null } | null;
      if (err instanceof DryRunRollback) {
        log("Dry run: rolled back.");
      } else if (err instanceof ImportStopped) {
        log(err.message);
        return await finish("FAILED", r?.partial ?? {}, err.message);
      } else {
        const message = plainError(err);
        log(`Stopped: ${message}`);
        return await finish("FAILED", r?.partial ?? {}, message);
      }
    }
    const r = result as { partial: Partial<ImportSummary>; error: string | null } | null;
    return await finish("SUCCEEDED", r?.partial ?? {}, null);
  } finally {
    if (!finished) {
      // finish() itself failed (for instance the database went away): never leave the row "running".
      await db.importRun
        .update({
          where: { id: run.id },
          data: {
            status: "FAILED",
            finishedAt: new Date(),
            error: "The run could not be recorded properly; see the Terminal or server log.",
          },
        })
        .catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------------------

async function ensureTaxYearStates(
  tx: DbOrTx,
  lk: Lookups,
  actor: ImportActor,
  now: Date,
): Promise<ImportSummary["taxYears"]> {
  const stamp = { closedAt: now, closedById: actor.userId, filedAt: now, filedById: actor.userId };
  const note = "Imported history (Phase 2); marked filed per CLAUDE.md";
  for (const t of SEED_TAX_YEARS) {
    const entityId = lk.entityByCode.get(t.entityCode) as string;
    const existing = await tx.taxYear.findUnique({
      where: { entityId_year: { entityId, year: t.year } },
    });
    if (!existing) {
      await tx.taxYear.create({
        data: {
          entityId,
          year: t.year,
          state: t.state,
          note: t.state === "FILED" ? note : null,
          ...(t.state === "FILED" ? stamp : {}),
        },
      });
    } else if (
      t.state === "FILED" &&
      existing.state === "OPEN" &&
      existing.overrideCount === 0 &&
      !existing.closedAt
    ) {
      // A filed history year that somehow sits open and untouched: close and file it in one step.
      await tx.taxYear.update({
        where: { id: existing.id },
        data: { state: "CLOSED", closedAt: now, closedById: actor.userId },
      });
      await tx.taxYear.update({
        where: { id: existing.id },
        data: {
          state: "FILED",
          filedAt: now,
          filedById: actor.userId,
          note: existing.note ?? note,
        },
      });
    } else if (t.state === "FILED" && existing.state === "FILED" && !existing.filedAt) {
      // Seeded as filed without a timestamp: record when the import confirmed it.
      await tx.taxYear.update({
        where: { id: existing.id },
        data: { ...stamp, note: existing.note ?? note },
      });
    }
  }
  const rows = await tx.taxYear.findMany({
    include: { entity: { select: { code: true } } },
    orderBy: [{ entity: { code: "asc" } }, { year: "asc" }],
  });
  return rows.map((r) => ({ entity: r.entity.code, year: r.year, state: r.state }));
}

async function insertReferenceModels(
  tx: DbOrTx,
  lk: Lookups,
  files: ReferenceModelFile[],
  actor: ImportActor,
  now: Date,
): Promise<{ existing: number; inserted: number }> {
  let existing = 0;
  let inserted = 0;
  const srei = lk.entityByCode.get("SREI") as string;
  for (const f of files) {
    const taxYear = await tx.taxYear.findUnique({
      where: { entityId_year: { entityId: srei, year: f.year } },
    });
    if (!taxYear) throw new Error(`No SREI tax year ${f.year} for the ${f.year} reference models.`);
    const names = modelNamesFor(f);
    for (const set of f.percentageSets) {
      const sourceKey = `${f.sheet}:${set.key}`;
      const found = await tx.allocationModel.findUnique({ where: { sourceKey } });
      if (found) {
        existing++;
        continue;
      }
      const targets = set.targets.filter((t) => t.target !== UMBRELLA_TARGET);
      const { bp, remainderIndex } = sharesToBasisPoints(targets.map((t) => t.share));
      const model = await tx.allocationModel.create({
        data: {
          entityId: srei,
          taxYearId: taxYear.id,
          name: names.get(set.key) as string,
          description: set.description || null,
          isReference: true,
          isActive: true,
          sourceKey,
          createdById: actor.userId,
          createdAt: now,
        },
      });
      const version = await tx.allocationModelVersion.create({
        data: {
          modelId: model.id,
          versionNo: 1,
          basis: set.basis,
          secondaryBasis: set.secondaryBasis ?? null,
          note: referenceModelNote(f, set),
          // The whole transcription of the year, so nothing about the worksheet is lost; thisSetKey says which set this version is.
          parameters: JSON.parse(
            JSON.stringify({ ...f, thisSetKey: set.key }),
          ) as Prisma.InputJsonValue,
          createdById: actor.userId,
          createdAt: now,
        },
      });
      await tx.allocationTarget.createMany({
        data: targets.map((t, i) => {
          const isPersonal = t.target === PERSONAL_TARGET;
          const classId = isPersonal ? null : lk.classByName.get(t.target);
          if (!isPersonal && !classId)
            throw new Error(
              `${f.year} · ${set.label}: target "${t.target}" is not a class in the seed.`,
            );
          return {
            versionId: version.id,
            classId: classId ?? null,
            isPersonal,
            label: t.label,
            weight: t.weight.toFixed(6),
            weight2: t.weight2 === null || t.weight2 === undefined ? null : t.weight2.toFixed(6),
            shareBp: bp[i] as number,
            isRemainderTarget: i === remainderIndex,
            sortOrder: i,
          };
        }),
      });
      await tx.allocationModel.update({
        where: { id: model.id },
        data: { currentVersionId: version.id },
      });
      inserted++;
    }
  }
  return { existing, inserted };
}

function baseSummary(
  runId: string,
  startedAt: Date,
  opts: ImportOptions,
  paths: { key: "A" | "B"; file: string; path: string }[],
  a: WorkbookAExtract,
  b: WorkbookBExtract,
  chart: SeedChart,
  preA: Check[],
  preB: Check[],
  modelChecks: Check[],
  modelFiles: ReferenceModelFile[],
  modelVerification: Map<
    number,
    { checked: number; mismatches: string[]; nonEmptyCells: number; accountedFor: number }
  >,
): ImportSummary {
  const kindsByYear: Record<string, Record<string, number>> = {};
  for (const e of a.entries) {
    const y = e.date.slice(0, 4);
    const k = (kindsByYear[y] ??= {});
    k[e.kind] = (k[e.kind] ?? 0) + 1;
  }
  const money = (n: bigint) => formatCents(n, { negative: "minus" });
  const byBank: Record<string, number> = {};
  const byClass: Record<string, number> = {};
  for (const r of b.rows) {
    byBank[r.bankRaw] = (byBank[r.bankRaw] ?? 0) + 1;
    byClass[r.className] = (byClass[r.className] ?? 0) + 1;
  }
  const unsplit = b.rows.filter((r) => r.needsModelSplit);
  const unsplitByClass: Record<string, number> = {};
  for (const r of unsplit) unsplitByClass[r.className] = (unsplitByClass[r.className] ?? 0) + 1;
  const prov1101 = b.rows.filter((r) => r.className === "Providence" && r.bankNumber === "1101");
  const gen1103 = b.rows.filter((r) => r.className === "General" && r.bankNumber === "1103");
  const other = b.rows.filter(
    (r) => isCrossEntityRow(r) && !(r.className === "Providence" && r.bankNumber === "1101"),
  );

  const seedNumbers = new Set(chart.byNumber.keys());
  const wbNumbers = new Set(a.chartRegion.map((c) => c.number));
  const differences: string[] = [];
  const seen = new Map<string, number>();
  for (const c of a.chartRegion) seen.set(c.number, (seen.get(c.number) ?? 0) + 1);
  for (const [n, count] of seen)
    if (count > 1)
      differences.push(
        `${n} appears ${count} times in the workbook's chart (${a.chartRegion
          .filter((c) => c.number === n)
          .map((c) => `${c.parentGroup} / ${c.type} / ${c.subType}`)
          .join(
            " and ",
          )}); the seed keeps one Asset account under 1500 Accounts Receivable (decision D5).`,
      );
  for (const c of a.chartRegion) {
    const sd = chart.byNumber.get(c.number);
    if (!sd) continue;
    const wbType = c.type.toUpperCase();
    if (
      wbType !== sd.type &&
      !(wbType === "EQUITY" && (sd.type === "INCOME" || sd.type === "EXPENSE"))
    )
      differences.push(`${c.number} ${c.name}: workbook type ${c.type}, seed type ${sd.type}.`);
    if (c.subType !== sd.subType && seen.get(c.number) === 1)
      differences.push(
        `${c.number} ${c.name}: workbook sub-type ${c.subType}, seed sub-type ${sd.subType}.`,
      );
    if (c.name !== sd.name)
      differences.push(`${c.number}: workbook name “${c.name}”, seed name “${sd.name}”.`);
  }
  if (
    a.chartRegion.some(
      (c) =>
        c.type === "Equity" &&
        (chart.byNumber.get(c.number)?.type === "INCOME" ||
          chart.byNumber.get(c.number)?.type === "EXPENSE"),
    )
  )
    differences.push(
      "Income and Expense accounts are typed “Equity” in the workbook; the seed types them by sub-type (Income / Expense), as DATA_SOURCES.md prescribes.",
    );

  const merged = a.entries
    .filter((e) => e.isMerged)
    .map((e) => {
      const bankGroup = e.subGroups.find((g) => g.touchesBank);
      const otherGroups = e.subGroups.filter((g) => !g.touchesBank);
      return {
        txn: e.txn,
        date: e.date,
        bankVendor: bankGroup?.name ?? "—",
        bankAmount: money(bankGroup?.totalCents ?? 0n),
        otherVendor: otherGroups.map((g) => g.name ?? "—").join(" / "),
        otherAmount: otherGroups.map((g) => money(g.totalCents)).join(" / "),
        otherAccounts: otherGroups.flatMap((g) => g.accounts).join("; "),
        rows: `${e.subGroups[0]?.firstRow ?? 0}–${e.subGroups[e.subGroups.length - 1]?.lastRow ?? 0}`,
      };
    });
  const selfCancelling = a.entries
    .filter((e) => e.isSelfCancelling)
    .map((e) => ({
      txn: e.txn,
      date: e.date,
      vendor: e.vendor ?? "—",
      amount: money(e.lines.reduce((t, l) => t + l.debitCents, 0n)),
      rows: `${e.lines[0]?.row ?? 0}–${e.lines[e.lines.length - 1]?.row ?? 0}`,
    }));

  const attention: ImportSummary["attention"] = [];
  const split = b.rows.filter((r) => r.isSplitPlaceholder);
  attention.push({
    title: "Flagged draft (not posted)",
    items: split.map(
      (r) =>
        `#${r.ref} ${r.date} ${r.vendor} ${money(r.amountCents)} (${r.className}, ${r.bankRaw}): the snapshot carried it as “(split - varies)” — capitalize vs expense between 1313 and 5215; the full amount sits on 1313 as a flagged draft until Jose itemises the desks and chairs. Until it is confirmed, the PLA bank balance in the app (posted rows only) is ${money(-r.amountCents)} higher than the bank statement, and the row is in no report.`,
    ),
  });
  const openQuestions = b.questionsForJose.filter(
    (q) =>
      !/^Resolved/i.test(q.group) &&
      !/re-confirm/i.test(q.group) &&
      !/allocation-model/i.test(q.group) &&
      !/^Maintenance Business/i.test(q.group),
  );
  attention.push({
    title: "Open questions from the snapshot's “Questions for Jose” sheet",
    items: openQuestions.map(
      (q) =>
        `**${q.number}. ${q.group}**${q.amount ? ` (${q.amount}${q.date ? `, ${q.date}` : ""})` : ""}: ${q.question}${q.why ? ` _Why it matters: ${q.why}_` : ""}`,
    ),
  });
  const groups = sameDayGroups(b.rows);
  attention.push({
    title: "Same-day identical rows (kept; each carries a system note naming the others)",
    items: groups.map(
      (g) =>
        `snapshot rows ${g.map((r) => `#${r.ref}`).join(", ")}: ${(g[0] as (typeof g)[number]).date} ${money((g[0] as (typeof g)[number]).amountCents)} on ${(g[0] as (typeof g)[number]).bankRaw} — ${[...new Set(g.map((r) => r.vendor))].join(" / ")}`,
    ),
  });
  const refunds = b.rows.filter((r) => r.accountNumber?.startsWith("5") && r.amountCents > 0n);
  attention.push({
    title: `Expense accounts with money coming in (${refunds.length} refunds / returns, posted as Dr bank / Cr expense)`,
    items: refunds.map(
      (r) =>
        `snapshot row #${r.ref} ${r.date} ${r.vendor} +${money(r.amountCents)} → ${r.accountRaw} (${r.className})`,
    ),
  });
  attention.push({
    title: "Rows waiting for the allocation-model system (Phase 5)",
    items: [
      `${unsplit.length} rows are tagged \`needs_model_split\` (net ${money(unsplit.reduce((t, r) => t + r.amountCents, 0n))}): ${Object.entries(
        unsplitByClass,
      )
        .map(([k, v]) => `${k} ${v}`)
        .join(
          ", ",
        )}. They were unsplit back to a single class on 2026-09-10 and are the first real use of the 2025 model once it exists.`,
    ],
  });
  attention.push({
    title: "Pre-PLA Providence rows (sole-proprietor report, decision D2)",
    items: [
      `${prov1101.filter((r) => r.date < TARGET_B.plaLaunchPlaceholder).length} Providence rows on 1101 are dated before ${TARGET_B.plaLaunchPlaceholder} (the placeholder launch date = the PLA bank account opening). Jose's actual launch date decides which rows belong to the old sole-proprietor consulting business.`,
    ],
  });
  attention.push({
    title: "2019–2024 entries worth a glance",
    items: [
      `${merged.length} workbook numbers cover two bookings (all 2024): the monthly Clubhouse rent booked as income against a capital distribution (no cash) and, under the same number, whatever hit the bank next. They are kept together to match the workbook; each row shows the bank movement's vendor, date and amount and the rent booking is visible in its journal lines. **Question for Jose and Jamin: split them into two transactions?** The list is below.`,
      `${selfCancelling.length} entries are a payment and its reversal on the same bank account (net 0.00); they are stored as journal entries so both lines stay visible: ${selfCancelling.map((e) => `#${e.txn} ${e.date} ${e.vendor} ${e.amount}`).join("; ")}.`,
      `Transfer between the old and the current bank account: ${
        a.entries
          .filter((e) => e.bankNumbers.length > 1)
          .map((e) => `#${e.txn} (${e.date})`)
          .join(", ") || "none"
      } — shown from 1101.`,
      `${a.entries.filter((e) => !e.vendor).length} entries have no Name on any line (year-end reallocations, depreciation, and bank-side entries); the ledger shows “—” as the vendor.`,
      `Wages: ${b.rows.filter((r) => r.accountNumber === "5226").length} 2025 rows on 5226 Wages Expense are booked at net pay (decision D7); each carries a reminder note about the payroll register.`,
    ],
  });
  attention.push({
    title: "Seed confirmations still open (docs/DESIGN.md §7)",
    items: [
      "1104 Venmo as the number and name for the Venmo cash account (decision D4).",
      "1313, 1315, 4103, 5226, 5227: parents and types were inferred from the 2025 books.",
      "1501 Tenant Rent Due kept as one Asset account under Accounts Receivable (decision D5).",
    ],
  });
  attention.push({
    title: "Receipts referenced by the snapshot",
    items: [
      `${b.rows.filter((r) => r.receipts > 0).length} rows expect ${b.rows.reduce((t, r) => t + r.receipts, 0)} receipt files that are not in the workbook (\`receipt_expected_count\` is set on each row). Phase 3 uploads and links them.`,
    ],
  });

  return {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    durationMs: 0,
    dryRun: opts.dryRun,
    trigger: opts.trigger,
    actorName: opts.actor.displayName,
    outcome: "SUCCEEDED",
    error: null,
    reportFileWarning: null,
    sources: paths.map((p) => ({
      key: p.key,
      file: p.file,
      path: p.path,
      sha256: p.key === "A" ? a.sha256 : b.sha256,
      bytes: statSync(p.path).size,
    })),
    extraction: {
      a: {
        lines: a.lines.length,
        entries: a.entries.length,
        linesWithAmounts: a.lines.filter((l) => !l.isZero).length,
        firstDate: a.lines.reduce((m, l) => (l.date < m ? l.date : m), "9999"),
        lastDate: a.lines.reduce((m, l) => (l.date > m ? l.date : m), ""),
        kindsByYear,
        transfers: a.entries.filter((e) => e.bankNumbers.length > 1).map((e) => e.txn),
        mixedDates: a.entries
          .filter((e) => e.mixedDates)
          .map((e) => ({ txn: e.txn, dates: [...new Set(e.lines.map((l) => l.date))].sort() })),
        merged,
        selfCancelling,
        normalised: a.lines
          .filter((l) => l.normalised)
          .map((l) => ({
            txn: l.txn,
            row: l.row,
            account: l.accountLabel,
            class: l.className,
            raw: l.rawDebit < 0 ? `Dr ${l.rawDebit.toFixed(2)}` : `Cr ${l.rawCredit.toFixed(2)}`,
            storedAs:
              l.debitCents > 0n ? `Dr ${cents(l.debitCents)}` : `Cr ${cents(l.creditCents)}`,
          })),
        zeroEntries: a.entries.filter((e) => e.isVoidPlaceholder).map((e) => e.txn),
        formulaCellsWithoutCachedResult: a.formulaCellsWithoutCachedResult,
        subCentAmounts: a.subCentAmounts.length,
        entriesWithoutName: a.entries.filter((e) => !e.vendor).length,
      },
      b: {
        rows: b.rows.length,
        stoppedAtRow: b.stoppedAtRow,
        firstDate: b.rows.reduce((m, r) => (r.date < m ? r.date : m), "9999"),
        lastDate: b.rows.reduce((m, r) => (r.date > m ? r.date : m), ""),
        byBank,
        byClass,
        unsplit: {
          count: unsplit.length,
          net: money(unsplit.reduce((t, r) => t + r.amountCents, 0n)),
          byClass: unsplitByClass,
        },
        joseRows: b.rows.filter((r) => r.verifiedByOwner).length,
        receiptRows: b.rows.filter((r) => r.receipts > 0).length,
        receiptFiles: b.rows.reduce((t, r) => t + r.receipts, 0),
        questionsForJose: b.questionsForJose,
      },
    },
    checks: { preA, preB, models: modelChecks, db: [] },
    load: {
      a: { existing: 0, inserted: 0 },
      b: { existing: 0, inserted: 0 },
      models: { existing: 0, inserted: 0 },
      lockedYearsTouched: [],
    },
    crossEntity: {
      providenceOn1101: prov1101.map((r) => ({
        ref: r.ref,
        date: r.date,
        vendor: r.vendor,
        amount: money(r.amountCents),
        account: r.accountRaw,
        beforeLaunch: r.date < TARGET_B.plaLaunchPlaceholder,
      })),
      generalOn1103: gen1103.map((r) => ({
        ref: r.ref,
        date: r.date,
        vendor: r.vendor,
        amount: money(r.amountCents),
        account: r.accountRaw,
      })),
      other: other.map((r) => ({
        ref: r.ref,
        date: r.date,
        vendor: r.vendor,
        amount: money(r.amountCents),
        account: r.accountRaw,
        class: r.className,
        bank: r.bankRaw,
      })),
      plaLaunchPlaceholder: TARGET_B.plaLaunchPlaceholder,
    },
    attention,
    chartDiff: {
      inWorkbookNotSeed: [...wbNumbers].filter((n) => !seedNumbers.has(n)).sort(),
      inSeedNotWorkbook: [...seedNumbers].filter((n) => !wbNumbers.has(n)).sort(),
      differences,
    },
    referenceModels: modelFiles.map((f) => {
      const names = modelNamesFor(f);
      const v = modelVerification.get(f.year) ?? {
        checked: 0,
        mismatches: [],
        nonEmptyCells: 0,
        accountedFor: 0,
      };
      return {
        year: f.year,
        sheet: f.sheet,
        method: f.method,
        verified: {
          checked: v.checked,
          mismatches: v.mismatches,
          nonEmptyCells: v.nonEmptyCells,
          accountedFor: v.accountedFor,
        },
        models: f.percentageSets.map((set) => {
          const targets = set.targets.filter((t) => t.target !== UMBRELLA_TARGET);
          let bp: number[] = [];
          let remainderIndex = -1;
          const problems = checkPercentageSet(set);
          try {
            const r = sharesToBasisPoints(targets.map((t) => t.share));
            bp = r.bp;
            remainderIndex = r.remainderIndex;
          } catch (err) {
            problems.push(err instanceof Error ? err.message : String(err));
          }
          return {
            name: names.get(set.key) as string,
            key: set.key,
            basis: set.basis,
            secondaryBasis: set.secondaryBasis ?? null,
            description: set.description,
            targets: targets.map((t, i) => ({
              label: t.label,
              target: t.target,
              weight: t.weight,
              weight2: t.weight2 ?? null,
              share: t.share,
              bp: bp[i] ?? 0,
              remainder: i === remainderIndex,
            })),
            problems,
          };
        }),
        bills: f.specificBills.map((bill) => ({
          label: bill.label,
          total: bill.total,
          setKey: bill.setKey ?? null,
        })),
      };
    }),
    taxYears: [],
  };
}
