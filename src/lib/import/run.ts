import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Prisma } from "@/generated/prisma/client";
import type { Db, DbOrTx } from "@/lib/db";
import { audit } from "@/lib/audit";
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
import {
  checkPercentageSet,
  loadReferenceModelFiles,
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
  WORKBOOK_A_FILE,
  WORKBOOK_B_FILE,
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
 *   3. inside ONE database transaction: lock override for the filed years, tax-year states, the
 *      transactions that are not there yet (idempotent on source file + source row), the reference
 *      models, then the same checklist read back from the database; a miss rolls everything back;
 *   4. one audit row for the run, an import_runs row, and the report (Settings → Data and
 *      docs/IMPORT_REPORT.md).
 *
 * Running it again is a no-op: every source row is already present, so 0 rows are inserted.
 */

export interface ImportOptions {
  sourceDir: string;
  modelsDir?: string;
  dryRun: boolean;
  actor: ImportActor & { displayName: string };
  trigger: "cli" | "app";
  /** Where to write the Markdown report; null to skip the file (the database keeps a copy anyway). */
  reportPath: string | null;
  log?: (line: string) => void;
}

export interface ImportOutcome {
  runId: string;
  status: "SUCCEEDED" | "FAILED";
  dryRun: boolean;
  summary: ImportSummary;
  report: string;
  allChecksPassed: boolean;
}

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

export function sourcePaths(sourceDir: string): { key: "A" | "B"; file: string; path: string }[] {
  return [
    { key: "A", file: WORKBOOK_A_FILE, path: path.join(sourceDir, WORKBOOK_A_FILE) },
    { key: "B", file: WORKBOOK_B_FILE, path: path.join(sourceDir, WORKBOOK_B_FILE) },
  ];
}

function critical(checks: Check[]): Check[] {
  return checks.filter((c) => !c.ok && c.critical);
}

export async function runImport(db: Db, opts: ImportOptions): Promise<ImportOutcome> {
  const log = opts.log ?? (() => {});
  const startedAt = new Date();
  const paths = sourcePaths(opts.sourceDir);
  for (const p of paths) {
    if (!existsSync(p.path))
      throw new ImportStopped(
        `The source workbook is missing: ${p.path}. Put the two workbooks in data/source/ (see DATA_SOURCES.md) and run again.`,
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
  const modelVerification = new Map<number, { checked: number; mismatches: string[] }>();
  for (const mf of modelFiles) {
    const v = verifyReferenceModelAgainstWorkbook(wbA, mf);
    const mismatches = v.mismatches.map(
      (m) => `${m.cell} (${m.where}): JSON ${m.expected} vs sheet ${m.found}`,
    );
    modelVerification.set(mf.year, { checked: v.checked, mismatches });
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
    const unaccounted = mf.coverage?.unaccounted ?? [];
    modelChecks.push({
      group: "Reference models",
      label: `${mf.year}: every non-empty worksheet cell is accounted for`,
      expected: "yes",
      actual: unaccounted.length
        ? `no (${unaccounted.length}: ${unaccounted.slice(0, 8).join(", ")})`
        : "yes",
      ok: unaccounted.length === 0,
      critical: false,
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
    const report = renderReport(summary);
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
        reportMarkdown: report,
        error,
      },
    });
    if (opts.reportPath && !opts.dryRun) {
      mkdirSync(path.dirname(opts.reportPath), { recursive: true });
      writeFileSync(opts.reportPath, report);
    }
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
    return { runId: run.id, status, dryRun: opts.dryRun, summary, report, allChecksPassed };
  };

  if (preCritical.length > 0) {
    const msg = `${preCritical.length} critical check${preCritical.length === 1 ? "" : "s"} failed before anything was written: ${preCritical
      .slice(0, 3)
      .map((c) => `${c.label} (expected ${c.expected}, found ${c.actual})`)
      .join("; ")}${preCritical.length > 3 ? "; …" : ""}. Nothing was changed.`;
    log(msg);
    return finish("FAILED", {}, msg);
  }

  // 3. Write, verify, commit (or roll back).
  let result: { partial: Partial<ImportSummary>; error: string | null } | null = null;
  try {
    await db.$transaction(
      async (tx) => {
        const lk = await buildLookups(tx);
        const now = new Date();
        await setLockOverride(tx, LOCK_OVERRIDE_REASON);

        // Tax-year states (kickoff item 4): create what is missing, never move a state backwards.
        const taxYears = await ensureTaxYearStates(tx, lk);

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
        log(
          `Writing ${preparedA.length.toLocaleString("en-US")} + ${preparedB.length} transactions (${haveA.size.toLocaleString("en-US")} + ${haveB.size} already present)…`,
        );
        await insertPrepared(tx, preparedA, (done, total) => log(`  2019–2024: ${done}/${total}`));
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
        const dbChecks = await checksFromDatabase(tx, {
          bridgedRowsB,
          kindsA,
          referenceModelsPerYear: Object.fromEntries(
            modelFiles.map((m) => [m.year, m.percentageSets.length]),
          ),
        });
        const failed = critical(dbChecks);
        const lockedYearsTouched = preparedA.length
          ? [...new Set(preparedA.map((p) => String((p.header.date as Date).getUTCFullYear())))]
              .sort()
              .map((y) => `SREI ${y}`)
          : [];
        const partial: Partial<ImportSummary> = {
          checks: { ...base.checks, db: dbChecks },
          load: {
            a: { existing: haveA.size, inserted: preparedA.length },
            b: { existing: haveB.size, inserted: preparedB.length },
            models,
            lockedYearsTouched,
          },
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
          reason: lockedYearsTouched.length ? LOCK_OVERRIDE_REASON : null,
          isLockOverride: lockedYearsTouched.length > 0,
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
    if (err instanceof DryRunRollback) {
      log("Dry run: rolled back.");
    } else if (err instanceof ImportStopped) {
      log(err.message);
      return finish(
        "FAILED",
        (result as { partial: Partial<ImportSummary> } | null)?.partial ?? {},
        err.message,
      );
    } else {
      const message = err instanceof Error ? err.message : String(err);
      log(`Stopped: ${message}`);
      return finish(
        "FAILED",
        (result as { partial: Partial<ImportSummary> } | null)?.partial ?? {},
        message,
      );
    }
  }
  const r = result as { partial: Partial<ImportSummary>; error: string | null } | null;
  return finish("SUCCEEDED", r?.partial ?? {}, null);
}

// ---------------------------------------------------------------------------

async function ensureTaxYearStates(tx: DbOrTx, lk: Lookups): Promise<ImportSummary["taxYears"]> {
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
          note:
            t.state === "FILED" ? "Imported history (Phase 2); marked filed per CLAUDE.md" : null,
        },
      });
    } else if (
      t.state === "FILED" &&
      existing.state === "OPEN" &&
      existing.overrideCount === 0 &&
      !existing.closedAt
    ) {
      // A filed history year that somehow sits open and untouched: close and file it in one step.
      await tx.taxYear.update({ where: { id: existing.id }, data: { state: "CLOSED" } });
      await tx.taxYear.update({
        where: { id: existing.id },
        data: {
          state: "FILED",
          note: existing.note ?? "Imported history (Phase 2); marked filed per CLAUDE.md",
        },
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
    const usedNames = new Set<string>();
    for (const set of f.percentageSets) {
      const sourceKey = `${f.sheet}:${set.key}`;
      const found = await tx.allocationModel.findUnique({ where: { sourceKey } });
      if (found) {
        existing++;
        continue;
      }
      let name = `${f.year} · ${set.label}`;
      if (usedNames.has(name)) name = `${name} (${set.key})`;
      usedNames.add(name);
      const targets = set.targets.filter((t) => t.target !== UMBRELLA_TARGET);
      const { bp, remainderIndex } = sharesToBasisPoints(targets.map((t) => t.share));
      const model = await tx.allocationModel.create({
        data: {
          entityId: srei,
          taxYearId: taxYear.id,
          name,
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
          parameters: JSON.parse(
            JSON.stringify({
              year: f.year,
              sheet: f.sheet,
              method: f.method,
              set,
              properties: f.properties,
              landValuation: f.landValuation ?? null,
              specificBills: f.specificBills.filter((bill) => bill.setKey === set.key),
              reallocationOfGeneral: f.reallocationOfGeneral
                ? {
                    ...f.reallocationOfGeneral,
                    rows: f.reallocationOfGeneral.rows.filter((r) => r.setKey === set.key),
                  }
                : null,
              other: f.other,
            }),
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
  modelVerification: Map<number, { checked: number; mismatches: string[] }>,
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
    const s = chart.byNumber.get(c.number);
    if (!s) continue;
    const seedType = s.type;
    const wbType = c.type.toUpperCase();
    if (
      wbType !== seedType &&
      !(wbType === "EQUITY" && (seedType === "INCOME" || seedType === "EXPENSE"))
    )
      differences.push(`${c.number} ${c.name}: workbook type ${c.type}, seed type ${s.type}.`);
    if (c.subType !== s.subType && seen.get(c.number) === 1)
      differences.push(
        `${c.number} ${c.name}: workbook sub-type ${c.subType}, seed sub-type ${s.subType}.`,
      );
    if (c.name !== s.name)
      differences.push(`${c.number}: workbook name “${c.name}”, seed name “${s.name}”.`);
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

  const attention: ImportSummary["attention"] = [];
  const split = b.rows.filter((r) => r.isSplitPlaceholder);
  attention.push({
    title: "Flagged draft (not posted)",
    items: split.map(
      (r) =>
        `#${r.ref} ${r.date} ${r.vendor} ${money(r.amountCents)} (${r.className}, ${r.bankRaw}): the snapshot carried it as “(split - varies)” — capitalize vs expense between 1313 and 5215; the full amount sits on 1313 as a flagged draft until Jose itemises the desks and chairs.`,
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
        `${g.map((r) => `#${r.ref}`).join(", ")}: ${(g[0] as (typeof g)[number]).date} ${money((g[0] as (typeof g)[number]).amountCents)} on ${(g[0] as (typeof g)[number]).bankRaw} — ${[...new Set(g.map((r) => r.vendor))].join(" / ")}`,
    ),
  });
  const refunds = b.rows.filter((r) => r.accountNumber?.startsWith("5") && r.amountCents > 0n);
  attention.push({
    title: `Expense accounts with money coming in (${refunds.length} refunds / returns, posted as Dr bank / Cr expense)`,
    items: refunds.map(
      (r) =>
        `#${r.ref} ${r.date} ${r.vendor} +${money(r.amountCents)} → ${r.accountRaw} (${r.className})`,
    ),
  });
  attention.push({
    title: "Rows waiting for the allocation-model system (Phase 5)",
    items: [
      `${unsplit.length} rows are tagged needs_model_split (net ${money(unsplit.reduce((t, r) => t + r.amountCents, 0n))}): ${Object.entries(
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
      `Entries whose lines carry two dates (rent booked on the 1st, deposited a day or two later): ${
        a.entries
          .filter((e) => e.mixedDates)
          .map((e) => `#${e.txn}`)
          .join(", ") || "none"
      } — imported on the earlier date, both dates in the system note.`,
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
      `${b.rows.filter((r) => r.receipts > 0).length} rows expect ${b.rows.reduce((t, r) => t + r.receipts, 0)} receipt files that are not in the workbook (receipt_expected_count is set on each row). Phase 3 uploads and links them.`,
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
    referenceModels: modelFiles.map((f) => ({
      year: f.year,
      sheet: f.sheet,
      method: f.method,
      verified: modelVerification.get(f.year) ?? { checked: 0, mismatches: [] },
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
          name: `${f.year} · ${set.label}`,
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
    })),
    taxYears: [],
  };
}
