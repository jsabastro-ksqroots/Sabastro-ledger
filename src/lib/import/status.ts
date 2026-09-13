import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { DbOrTx } from "@/lib/db";
import { sha256File } from "./xlsx";
import { sourcePaths } from "./run";
import { SOURCE_A, SOURCE_B } from "./types";

/** What Settings → Data shows: the source files on disk, what is in the ledger, and the runs so far. */

export function importSourceDir(): string {
  return process.env.IMPORT_SOURCE_DIR || path.join(process.cwd(), "data", "source");
}

export interface SourceStatus {
  key: "A" | "B";
  file: string;
  label: string;
  present: boolean;
  bytes: number | null;
  modifiedAt: string | null;
  sha256: string | null;
  transactions: { posted: number; flagged: number; voided: number; draft: number };
  firstDate: string | null;
  lastDate: string | null;
}

const LABELS: Record<string, string> = {
  [SOURCE_A]: "2019–2024 general ledger and tax worksheets (SREI)",
  [SOURCE_B]: "2025 ledger snapshot (SREI + PLA), final review copy of 2026-09-10",
};

export async function sourceStatuses(tx: DbOrTx, dir = importSourceDir()): Promise<SourceStatus[]> {
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
    out.push({
      key: p.key,
      file: p.file,
      label: LABELS[p.file] ?? p.file,
      present,
      bytes: st?.size ?? null,
      modifiedAt: st ? st.mtime.toISOString() : null,
      sha256: present ? await sha256File(p.path) : null,
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

export interface ImportRunRow {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  dryRun: boolean;
  trigger: string;
  runBy: string | null;
  allChecksPassed: boolean | null;
  inserted: { a: number; b: number; models: number } | null;
  skipped: { a: number; b: number; models: number } | null;
  checks: { total: number; failed: number } | null;
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
  return runs.map((r) => {
    const s = (r.summary ?? null) as null | {
      load?: {
        a?: { inserted: number; existing: number };
        b?: { inserted: number; existing: number };
        models?: { inserted: number; existing: number };
      };
      checks?: Record<string, { ok: boolean }[]>;
    };
    const allChecks = s?.checks ? Object.values(s.checks).flat() : null;
    return {
      id: r.id,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      status: r.status,
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
      checks: allChecks
        ? { total: allChecks.length, failed: allChecks.filter((c) => !c.ok).length }
        : null,
      error: r.error,
      hasReport: !!r.reportMarkdown,
    };
  });
}

export async function importRunReport(
  tx: DbOrTx,
  id: string | null,
): Promise<{
  id: string;
  startedAt: Date;
  markdown: string;
  dryRun: boolean;
  status: string;
} | null> {
  const run = id
    ? await tx.importRun.findUnique({ where: { id } })
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
