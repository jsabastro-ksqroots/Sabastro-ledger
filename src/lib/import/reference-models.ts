import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type ExcelJS from "exceljs";
import { cellScalar, requireSheet } from "./xlsx";

/**
 * The 2020–2024 Tax Worksheet parameters, transcribed to seed/reference_models/<year>.json and imported
 * as archived, read-only reference models (one model per percentage set, one version each). Every
 * number in the JSON carries the sheet cell it came from, so the import re-checks the transcription
 * against the workbook before storing it. Nothing here is ever applied to transactions.
 */

export const PERSONAL_TARGET = "PERSONAL";
export const UMBRELLA_TARGET = "UMBRELLA";

const basis = z.enum(["PERCENT", "VALUE", "ACRES", "MONTHS", "COUNT"]);
const cellRef = z.string().regex(/^[A-Z]{1,3}\d{1,5}$/, "cell address like E11");
const money = z.number();

const target = z
  .object({
    label: z.string().min(1),
    target: z.string().min(1),
    weight: z.number(),
    weightCell: cellRef.nullable().optional(),
    weight2: z.number().nullable().optional(),
    weight2Cell: cellRef.nullable().optional(),
    share: z.number(),
    shareCell: cellRef.nullable().optional(),
  })
  .passthrough();

const percentageSet = z
  .object({
    key: z.string().regex(/^[a-z0-9_]+$/),
    label: z.string().min(1),
    basis,
    secondaryBasis: basis.nullable().optional(),
    description: z.string().optional().default(""),
    cellRange: z.string().optional().default(""),
    targets: z.array(target).min(1),
    usedFor: z.array(z.string()).optional().default([]),
  })
  .passthrough();

const specificBill = z
  .object({
    label: z.string().min(1),
    total: money,
    totalCell: cellRef.nullable().optional(),
    setKey: z.string().nullable().optional(),
    note: z.string().optional().default(""),
    allocations: z
      .array(
        z.object({
          label: z.string(),
          target: z.string(),
          amount: money,
          cell: cellRef.nullable().optional(),
        }),
      )
      .optional()
      .default([]),
  })
  .passthrough();

const reallocation = z
  .object({
    cellRange: z.string().optional().default(""),
    columns: z.array(z.object({ label: z.string(), target: z.string() })),
    rows: z.array(
      z
        .object({
          account: z.string(),
          accountLabel: z.string(),
          total: money,
          totalCell: cellRef.nullable().optional(),
          setKey: z.string().nullable().optional(),
          amounts: z.array(z.number().nullable()),
          amountCells: z.string().optional().default(""),
        })
        .passthrough(),
    ),
    /** Documentation only; the per-column totals differ in shape between years and pass through untouched. */
    totals: z
      .object({
        grand: z.number().nullable().optional(),
        cell: cellRef.nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export const referenceModelFileSchema = z
  .object({
    year: z.number().int().min(2019).max(2030),
    sheet: z.string().min(1),
    method: z.string().min(40),
    properties: z.array(
      z
        .object({
          label: z.string(),
          target: z.string(),
          acres: z.number().nullable().optional(),
          acresCell: cellRef.nullable().optional(),
          value: z.number().nullable().optional(),
          valueCell: cellRef.nullable().optional(),
          lots: z.number().nullable().optional(),
          lotsCell: cellRef.nullable().optional(),
          note: z.string().optional().default(""),
        })
        .passthrough(),
    ),
    landValuation: z
      .object({
        perLot: z.number().nullable().optional(),
        perLotCell: cellRef.nullable().optional(),
        lots: z.number().nullable().optional(),
        lotsCell: cellRef.nullable().optional(),
        perAcre: z.number().nullable().optional(),
        perAcreCell: cellRef.nullable().optional(),
        acres: z.number().nullable().optional(),
        acresCell: cellRef.nullable().optional(),
        total: z.number().nullable().optional(),
        totalCell: cellRef.nullable().optional(),
      })
      .nullable()
      .optional(),
    percentageSets: z.array(percentageSet).min(1),
    specificBills: z.array(specificBill).optional().default([]),
    reallocationOfGeneral: reallocation.nullable().optional(),
    other: z
      .array(
        z
          .object({
            title: z.string(),
            cellRange: z.string().optional().default(""),
            summary: z.string().optional().default(""),
            data: z.unknown().optional(),
          })
          .passthrough(),
      )
      .optional()
      .default([]),
    coverage: z
      .object({
        nonEmptyCells: z.number().optional(),
        accountedFor: z.number().optional(),
        unaccounted: z.array(z.string()).optional().default([]),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type ReferenceModelFile = z.infer<typeof referenceModelFileSchema>;
export type ReferencePercentageSet = z.infer<typeof percentageSet>;

export function referenceModelDir(cwd = process.cwd()): string {
  return path.join(cwd, "seed", "reference_models");
}

export function loadReferenceModelFiles(dir = referenceModelDir()): ReferenceModelFile[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((f) => /^\d{4}\.json$/.test(f));
  } catch {
    return [];
  }
  return names.sort().map((name) => {
    const raw = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as unknown;
    const parsed = referenceModelFileSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new Error(
        `seed/reference_models/${name} is not a valid reference model file: ${issues}`,
      );
    }
    if (String(parsed.data.year) !== name.replace(".json", ""))
      throw new Error(
        `seed/reference_models/${name}: the year inside (${parsed.data.year}) does not match the file name.`,
      );
    return parsed.data;
  });
}

/**
 * Shares in basis points (must sum to 10,000). Each share is floored from the sheet's fraction and the
 * rounding remainder goes to the largest share (the app's default remainder rule), which is also the
 * remainder target of the version.
 */
export function sharesToBasisPoints(shares: readonly number[]): {
  bp: number[];
  remainderIndex: number;
} {
  if (shares.length === 0) throw new Error("A percentage set needs at least one target.");
  const total = shares.reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 0.0005)
    throw new Error(`The shares total ${total.toFixed(6)}, not 1.000000.`);
  const bp = shares.map((s) => Math.floor(s * 10_000 + 1e-9));
  const allocated = bp.reduce((a, b) => a + b, 0);
  let remainderIndex = 0;
  shares.forEach((s, i) => {
    if (s > (shares[remainderIndex] as number)) remainderIndex = i;
  });
  bp[remainderIndex] = (bp[remainderIndex] as number) + (10_000 - allocated);
  if (bp.some((b) => b < 0 || b > 10_000)) throw new Error("A share fell outside 0–100 %.");
  return { bp, remainderIndex };
}

export interface CellMismatch {
  sheet: string;
  cell: string;
  expected: string;
  found: string;
  where: string;
}

function close(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

/**
 * Re-checks every number that carries a cell address against the workbook's cached values. Money to the
 * cent, fractions to 5 decimals (the sheet shows 6 but Excel's floats carry noise beyond that).
 */
export function verifyReferenceModelAgainstWorkbook(
  wb: ExcelJS.Workbook,
  file: ReferenceModelFile,
): { checked: number; mismatches: CellMismatch[] } {
  const ws = requireSheet(wb, file.sheet);
  const mismatches: CellMismatch[] = [];
  let checked = 0;
  const num = (
    cell: string | null | undefined,
    expected: number | null | undefined,
    tolerance: number,
    where: string,
  ) => {
    if (!cell || expected === null || expected === undefined) return;
    checked++;
    const v = cellScalar(ws.getCell(cell));
    const found = typeof v === "number" ? v : v === null ? 0 : Number(v);
    if (!Number.isFinite(found) || !close(found, expected, tolerance)) {
      mismatches.push({
        sheet: file.sheet,
        cell,
        expected: String(expected),
        found: String(v),
        where,
      });
    }
  };
  for (const p of file.properties) {
    num(p.acresCell, p.acres, 0.0001, `property ${p.label} acres`);
    num(p.valueCell, p.value, 0.005, `property ${p.label} value`);
    num(p.lotsCell, p.lots, 0.0001, `property ${p.label} lots`);
  }
  const lv = file.landValuation;
  if (lv) {
    num(lv.perLotCell, lv.perLot, 0.005, "land valuation per lot");
    num(lv.lotsCell, lv.lots, 0.0001, "land valuation lots");
    num(lv.perAcreCell, lv.perAcre, 0.005, "land valuation per acre");
    num(lv.acresCell, lv.acres, 0.0001, "land valuation acres");
    num(lv.totalCell, lv.total, 0.005, "land valuation total");
  }
  for (const s of file.percentageSets) {
    for (const t of s.targets) {
      num(
        t.weightCell,
        t.weight,
        s.basis === "PERCENT" ? 0.00001 : 0.005,
        `set ${s.key} · ${t.label} weight`,
      );
      num(t.weight2Cell, t.weight2 ?? null, 0.0001, `set ${s.key} · ${t.label} weight2`);
      num(t.shareCell, t.share, 0.00001, `set ${s.key} · ${t.label} share`);
    }
  }
  for (const b of file.specificBills) {
    num(b.totalCell, b.total, 0.005, `bill ${b.label} total`);
    for (const a of b.allocations) num(a.cell, a.amount, 0.005, `bill ${b.label} → ${a.label}`);
  }
  const r = file.reallocationOfGeneral;
  if (r) {
    for (const row of r.rows) {
      num(row.totalCell, row.total, 0.005, `reallocation ${row.accountLabel} total`);
      const m = row.amountCells.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      if (m && m[2] === m[4]) {
        const from = colIndex(m[1] as string);
        const to = colIndex(m[3] as string);
        row.amounts.forEach((amount, i) => {
          if (amount === null || from + i > to) return;
          num(
            `${colName(from + i)}${m[2]}`,
            amount,
            0.005,
            `reallocation ${row.accountLabel} column ${i + 1}`,
          );
        });
      }
    }
    if (r.totals?.cell)
      num(r.totals.cell, r.totals.grand ?? null, 0.005, "reallocation grand total");
  }
  return { checked, mismatches };
}

function colIndex(name: string): number {
  let n = 0;
  for (const ch of name) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function colName(index: number): string {
  let s = "";
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Arithmetic sanity of a set independent of the workbook: shares sum to 1 and follow the weights. */
export function checkPercentageSet(set: ReferencePercentageSet): string[] {
  const problems: string[] = [];
  const total = set.targets.reduce((a, t) => a + t.share, 0);
  if (!close(total, 1, 0.00002)) problems.push(`${set.key}: shares total ${total.toFixed(6)}`);
  if (set.basis !== "PERCENT") {
    const weightOf = (t: (typeof set.targets)[number]) =>
      set.secondaryBasis ? t.weight * (t.weight2 ?? 0) : t.weight;
    const sum = set.targets.reduce((a, t) => a + weightOf(t), 0);
    if (sum > 0) {
      for (const t of set.targets) {
        const expected = weightOf(t) / sum;
        if (!close(expected, t.share, 0.00002))
          problems.push(
            `${set.key} · ${t.label}: share ${t.share} but weight gives ${expected.toFixed(6)}`,
          );
      }
    }
  } else {
    for (const t of set.targets) {
      if (!close(t.weight, t.share, 0.00002))
        problems.push(
          `${set.key} · ${t.label}: PERCENT basis but weight ${t.weight} ≠ share ${t.share}`,
        );
    }
  }
  return problems;
}

/** The plain-English note stored on a reference model's version. */
export function referenceModelNote(file: ReferenceModelFile, set: ReferencePercentageSet): string {
  const used = set.usedFor.length ? ` Used for: ${set.usedFor.join("; ")}.` : "";
  return `Archived reference model transcribed from the "${file.sheet}" tab of the 2019–2024 workbook (${set.label}: ${set.description || "see the year's method"}).${used}\n\nHow ${file.year} was done: ${file.method}`;
}
