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
const CELL_RE = /^[A-Z]{1,3}\d{1,5}$/;
const cellRef = z.string().regex(CELL_RE, "cell address like E11");
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

const allocation = z
  .object({
    label: z.string(),
    target: z.string(),
    amount: money,
    cell: cellRef.nullable().optional(),
  })
  .passthrough();

const specificBill = z
  .object({
    label: z.string().min(1),
    total: money,
    totalCell: cellRef.nullable().optional(),
    setKey: z.string().nullable().optional(),
    note: z.string().optional().default(""),
    allocations: z.array(allocation).optional().default([]),
  })
  .passthrough();

const reallocation = z
  .object({
    cellRange: z.string().optional().default(""),
    columns: z.array(z.object({ label: z.string(), target: z.string() }).passthrough()),
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
      .passthrough()
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

/** The name a percentage set gets as a model ("2024 · % (all)"); unique within the year, like the database requires. */
export function modelNamesFor(file: ReferenceModelFile): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const set of file.percentageSets) {
    let name = `${file.year} · ${set.label}`;
    if (used.has(name)) name = `${name} (${set.key})`;
    used.add(name);
    out.set(set.key, name);
  }
  return out;
}

/**
 * Shares in basis points (must sum to 10,000). Each share is rounded to the nearest basis point so every
 * target sits within half a basis point of the sheet; the residual (normally 0, at most a point or two)
 * goes to the largest share, which is also the version's remainder target.
 */
export function sharesToBasisPoints(shares: readonly number[]): {
  bp: number[];
  remainderIndex: number;
} {
  if (shares.length === 0) throw new Error("A percentage set needs at least one target.");
  const total = shares.reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 0.0005)
    throw new Error(`The shares total ${total.toFixed(6)}, not 1.000000.`);
  const bp = shares.map((s) => Math.round(s * 10_000));
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

/** Money to the cent, fractions to 5 decimals (the sheet shows 6 but Excel's floats carry noise beyond that). */
function toleranceFor(expected: number): number {
  return Math.abs(expected) >= 1 ? 0.005 : 0.00001;
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

/**
 * Re-checks every number that carries a cell address against the workbook's cached values — wherever it
 * sits in the file: any key ending in "Cell" whose sibling (the key without "Cell") is a number is
 * checked, plus the reallocation rows' amount ranges.
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
    where: string,
  ) => {
    if (!cell || expected === null || expected === undefined || !CELL_RE.test(cell)) return;
    checked++;
    const v = cellScalar(ws.getCell(cell));
    const found = typeof v === "number" ? v : v === null ? 0 : Number(v);
    if (!Number.isFinite(found) || !close(found, expected, toleranceFor(expected))) {
      mismatches.push({
        sheet: file.sheet,
        cell,
        expected: String(expected),
        found: String(v),
        where,
      });
    }
  };
  const walk = (node: unknown, where: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${where}[${i}]`));
      return;
    }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(o)) {
      if (key.endsWith("Cell") && typeof value === "string") {
        const sibling = o[key.slice(0, -4)];
        if (typeof sibling === "number")
          num(
            value,
            sibling,
            `${where}.${key.slice(0, -4)}${typeof o.label === "string" ? ` (${o.label})` : ""}`,
          );
      } else if (value && typeof value === "object") {
        walk(value, `${where}.${key}`);
      }
    }
  };
  walk(
    {
      properties: file.properties,
      landValuation: file.landValuation,
      percentageSets: file.percentageSets,
      specificBills: file.specificBills,
      reallocationOfGeneral: file.reallocationOfGeneral,
      other: file.other,
      extras: Object.fromEntries(
        Object.entries(file).filter(
          ([k]) =>
            ![
              "year",
              "sheet",
              "method",
              "properties",
              "landValuation",
              "percentageSets",
              "specificBills",
              "reallocationOfGeneral",
              "other",
              "coverage",
            ].includes(k),
        ),
      ),
    },
    String(file.year),
  );
  const r = file.reallocationOfGeneral;
  if (r) {
    for (const row of r.rows) {
      const m = row.amountCells.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      if (m && m[2] === m[4]) {
        const from = colIndex(m[1] as string);
        const to = colIndex(m[3] as string);
        row.amounts.forEach((amount, i) => {
          if (amount === null || from + i > to) return;
          num(
            `${colName(from + i)}${m[2]}`,
            amount,
            `reallocation ${row.accountLabel} column ${i + 1}`,
          );
        });
      }
    }
  }
  return { checked, mismatches };
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

/**
 * Every specific bill that names a percentage set must be that set applied to its total: each allocation
 * target belongs to the set, the allocations add up to the total, and each one is total × share.
 */
export function checkSpecificBills(file: ReferenceModelFile): string[] {
  const problems: string[] = [];
  const sets = new Map(file.percentageSets.map((s) => [s.key, s]));
  for (const bill of file.specificBills) {
    if (!bill.setKey) continue;
    const set = sets.get(bill.setKey);
    if (!set) {
      problems.push(
        `${bill.label}: names the set "${bill.setKey}", which the file does not define`,
      );
      continue;
    }
    if (bill.allocations.length === 0) {
      problems.push(`${bill.label}: names the set "${bill.setKey}" but carries no allocations`);
      continue;
    }
    const shares = new Map(set.targets.map((t) => [t.target, t.share]));
    let sum = 0;
    for (const a of bill.allocations) {
      sum += a.amount;
      const share = shares.get(a.target);
      if (share === undefined) {
        // A property the sheet lists with an explicit 0 (2024's H11 for 1621-1675) simply gets nothing from this set.
        if (a.amount !== 0)
          problems.push(
            `${bill.label}: allocation "${a.label}" (${a.target}) is not a target of ${set.key}`,
          );
        continue;
      }
      if (!close(a.amount, bill.total * share, 0.02))
        problems.push(
          `${bill.label} → ${a.label}: ${a.amount} but ${bill.total} × ${share} = ${(bill.total * share).toFixed(2)}`,
        );
    }
    if (!close(sum, bill.total, 0.01 * Math.max(1, bill.allocations.length)))
      problems.push(
        `${bill.label}: allocations add up to ${sum.toFixed(2)}, not the total ${bill.total}`,
      );
  }
  return problems;
}

/** The plain-English note stored on a reference model's version. */
export function referenceModelNote(file: ReferenceModelFile, set: ReferencePercentageSet): string {
  const used = set.usedFor.length ? ` Used for: ${set.usedFor.join("; ")}.` : "";
  return `Archived reference model transcribed from the "${file.sheet}" tab of the 2019–2024 workbook (${set.label}: ${set.description || "see the year's method"}).${used}\n\nHow ${file.year} was done: ${file.method}`;
}
