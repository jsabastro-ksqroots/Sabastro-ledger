import { existsSync, statSync } from "node:fs";
import type { DbOrTx } from "@/lib/db";
import { sha256File } from "./xlsx";
import { importSourceDir, sourcePaths } from "./paths";
import { STALE_RUN_MS } from "./run";
import type { ImportSummary } from "./report";
import { SOURCE_A, SOURCE_B, type Check } from "./types";

/** What Settings → Data shows: the source files on disk, what is in the ledger, and the runs so far. */

export { importSourceDir };

export interface SourceStatus {
  key: "A" | "B";
  file: string;
  label: string;
  present: boolean;
  bytes: number | null;
  modifiedAt: string | null;
  sha256: string | null;
  /** The file's hash when it was last imported for real, and when. */
  importedSha256: string | null;
  importedAt: string | null;
  changedSinceImport: boolean;
  transactions: { posted: number; flagged: number; voided: number; draft: number };
  firstDate: string | null;
  lastDate: string | null;
}

const LABELS: Record<string, string> = {
  [SOURCE_A]: "2019–2024 general ledger and tax worksheets (SREI)",
  [SOURCE_B]: "2025 ledger snapshot (SREI + PLA), final review copy of 2026-09-10",
};

type StoredSource = { key: string; file: string; sha256: string; bytes: number };

export async function sourceStatuses(tx: DbOrTx, dir = importSourceDir()): Promise<SourceStatus[]> {
  const lastReal = await tx.importRun.findFirst({
    where: { status: "SUCCEEDED", dryRun: false },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true, sources: true },
  });
  const imported = new Map<string, { sha256: string; at: string }>();
  if (lastReal && Array.isArray(lastReal.sources)) {
    for (const src of lastReal.sources as StoredSource[])
      imported.set(src.file, { sha256: src.sha256, at: lastReal.startedAt.toISOString() });
  }
  const out: SourceStatus[] = [];
  for (const p of sourcePaths(dir)) {
    const present = existsSync(p.path);
    const st = present ? statSync(p.path) : null;
    const counts = await tx.transaction.groupBy({
      by: ["status"],
      where: { sourceFile: p.file },
      _count: { _all: true },
    });
    const range = await tx.transaction.aggregate({
      where: { sourceFile: p.file },
      _min: { date: true },
      _max: { date: true },
    });
    const n = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
    const sha256 = present ? await sha256File(p.path) : null;
    const imp = imported.get(p.file);
    out.push({
      key: p.key,
      file: p.file,
      label: LABELS[p.file] ?? p.file,
      present,
      bytes: st?.size ?? null,
      modifiedAt: st ? st.mtime.toISOString() : null,
      sha256,
      importedSha256: imp?.sha256 ?? null,
      importedAt: imp?.at ?? null,
      changedSinceImport: !!(present && imp && sha256 !== imp.sha256),
      transactions: {
        posted: n("POSTED"),
        flagged: n("FLAGGED"),
        voided: n("VOIDED"),
        draft: n("DRAFT"),
      },
      firstDate: range._min.date ? range._min.date.toISOString().slice(0, 10) : null,
      lastDate: range._max.date ? range._max.date.toISOString().slice(0, 10) : null,
    });
  }
  return out;
}

export interface ChecksSummary {
  total: number;
  failed: number;
  failedCritical: number;
}

/** One way of counting for every screen: total, failed (any), failed critical. */
export function checksSummary(summary: Pick<ImportSummary, "checks"> | null): ChecksSummary | null {
  if (!summary?.checks) return null;
  const all: Check[] = Object.values(summary.checks).flat();
  return {
    total: all.length,
    failed: all.filter((c) => !c.ok).length,
    failedCritical: all.filter((c) => !c.ok && c.critical).length,
  };
}

/** The sentence the buttons and the runs table share. */
export function checksSentence(c: ChecksSummary): string {
  const pass = `${(c.total - c.failed).toLocaleString("en-US")} of ${c.total.toLocaleString("en-US")} checks pass`;
  if (c.failed === 0) return pass;
  const notes = c.failed - c.failedCritical;
  if (c.failedCritical === 0)
    return `${pass} (${notes} informational note${notes === 1 ? "" : "s"}, see the report)`;
  return `${pass} (${c.failedCritical} critical difference${c.failedCritical === 1 ? "" : "s"}, see the report)`;
}

export interface ImportRunRow {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  /** A "running" row older than an hour: the app stopped before finishing it. */
  isStale: boolean;
  dryRun: boolean;
  trigger: string;
  runBy: string | null;
  allChecksPassed: boolean | null;
  inserted: { a: number; b: number; models: number } | null;
  skipped: { a: number; b: number; models: number } | null;
  checks: ChecksSummary | null;
  error: string | null;
  hasReport: boolean;
}

export async function listImportRuns(tx: DbOrTx, limit = 30): Promise<ImportRunRow[]> {
  const runs = await tx.importRun.findMany({ orderBy: { startedAt: "desc" }, take: limit });
  const userIds = [...new Set(runs.map((r) => r.runById).filter((x): x is string => !!x))];
  const users = userIds.length
    ? await tx.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const names = new Map(users.map((u) => [u.id, u.displayName]));
  const now = Date.now();
  return runs.map((r) => {
    const s = (r.summary ?? null) as null | Pick<ImportSummary, "checks" | "load">;
    return {
      id: r.id,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      status: r.status,
      isStale: r.status === "RUNNING" && now - r.startedAt.getTime() > STALE_RUN_MS,
      dryRun: r.dryRun,
      trigger: r.trigger,
      runBy: r.runById ? (names.get(r.runById) ?? null) : null,
      allChecksPassed: r.allChecksPassed,
      inserted: s?.load
        ? {
            a: s.load.a?.inserted ?? 0,
            b: s.load.b?.inserted ?? 0,
            models: s.load.models?.inserted ?? 0,
          }
        : null,
      skipped: s?.load
        ? {
            a: s.load.a?.existing ?? 0,
            b: s.load.b?.existing ?? 0,
            models: s.load.models?.existing ?? 0,
          }
        : null,
      checks: checksSummary(s),
      error: r.error,
      hasReport: !!r.reportMarkdown,
    };
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The report of one run (?run=<id>), or of the newest real run, or of the newest run with a report. A bad id is simply "not found". */
export async function importRunReport(
  tx: DbOrTx,
  id: string | null,
): Promise<{
  id: string;
  startedAt: Date;
  markdown: string;
  dryRun: boolean;
  status: string;
  isLatestReal: boolean;
} | null> {
  if (id !== null && !UUID_RE.test(id)) return null;
  const latestReal = await tx.importRun.findFirst({
    where: { reportMarkdown: { not: null }, dryRun: false, status: "SUCCEEDED" },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  const run = id
    ? await tx.importRun.findUnique({ where: { id } })
    : latestReal
      ? await tx.importRun.findUnique({ where: { id: latestReal.id } })
      : await tx.importRun.findFirst({
          where: { reportMarkdown: { not: null } },
          orderBy: { startedAt: "desc" },
        });
  if (!run || !run.reportMarkdown) return null;
  return {
    id: run.id,
    startedAt: run.startedAt,
    markdown: run.reportMarkdown,
    dryRun: run.dryRun,
    status: run.status,
    isLatestReal: latestReal?.id === run.id,
  };
}

export interface ReferenceModelRow {
  year: number;
  name: string;
  basis: string;
  secondaryBasis: string | null;
  targets: { label: string; className: string | null; isPersonal: boolean; sharePct: string }[];
}

export async function listReferenceModels(tx: DbOrTx): Promise<ReferenceModelRow[]> {
  const models = await tx.allocationModel.findMany({
    where: { isReference: true },
    include: {
      taxYear: { select: { year: true } },
      versions: {
        orderBy: { versionNo: "desc" },
        take: 1,
        include: {
          targets: {
            orderBy: { sortOrder: "asc" },
            include: { class: { select: { name: true } } },
          },
        },
      },
    },
    orderBy: [{ taxYear: { year: "asc" } }, { name: "asc" }],
  });
  return models.map((m) => {
    const v = m.versions[0];
    return {
      year: m.taxYear.year,
      name: m.name,
      basis: v?.basis ?? "—",
      secondaryBasis: v?.secondaryBasis ?? null,
      targets: (v?.targets ?? []).map((t) => ({
        label: t.label,
        className: t.class?.name ?? null,
        isPersonal: t.isPersonal,
        sharePct: (t.shareBp / 100).toFixed(2),
      })),
    };
  });
}
