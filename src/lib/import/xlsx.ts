import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import ExcelJS from "exceljs";

/**
 * Thin helpers over exceljs for the two source workbooks. Every formula cell is read through its CACHED
 * result (the workbooks were last saved by Excel, so the cached values are what the users saw); a formula
 * cell with no cached result counts as empty and is tallied so the import report can say how many there
 * were. Dates come back as "YYYY-MM-DD" strings; the workbooks store calendar dates at midnight UTC.
 */

export type CellScalar = string | number | boolean | null;

export interface ReadStats {
  /** Formula cells whose cached result was missing (treated as empty). */
  formulaCellsWithoutCachedResult: number;
  /** Their addresses (first 500), so the report can say which cells were read as empty. */
  formulaCellsWithoutCachedResultAddresses: string[];
  /** Cells that held an Excel error value (treated as empty). */
  errorCells: number;
}

export function newReadStats(): ReadStats {
  return {
    formulaCellsWithoutCachedResult: 0,
    formulaCellsWithoutCachedResultAddresses: [],
    errorCells: 0,
  };
}

function isRichText(v: unknown): v is ExcelJS.CellRichTextValue {
  return !!v && typeof v === "object" && "richText" in (v as object);
}

/** The scalar behind a cell: formula results resolved, rich text flattened, dates as ISO calendar dates. */
export function cellScalar(cell: ExcelJS.Cell, stats?: ReadStats): CellScalar {
  const raw = cell.value as unknown;
  return scalarOf(raw, stats, cell.address);
}

function scalarOf(raw: unknown, stats?: ReadStats, address?: string): CellScalar {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return dateToIso(raw);
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return raw;
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if ("formula" in o || "sharedFormula" in o) {
      if (o.result === undefined || o.result === null) {
        if (stats) {
          stats.formulaCellsWithoutCachedResult++;
          if (address && stats.formulaCellsWithoutCachedResultAddresses.length < 500)
            stats.formulaCellsWithoutCachedResultAddresses.push(address);
        }
        return null;
      }
      return scalarOf(o.result, stats, address);
    }
    if (isRichText(raw)) return raw.richText.map((r) => r.text).join("");
    if ("error" in o) {
      if (stats) stats.errorCells++;
      return null;
    }
    if ("text" in o && typeof o.text === "string") return o.text; // hyperlink
    if ("hyperlink" in o && typeof o.hyperlink === "string") return o.hyperlink;
  }
  return String(raw);
}

export function dateToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Text of a cell, trimmed; null when empty. Numbers are rendered as they are. */
export function cellText(cell: ExcelJS.Cell, stats?: ReadStats): string | null {
  const v = cellScalar(cell, stats);
  if (v === null) return null;
  const s = typeof v === "string" ? v : String(v);
  const trimmed = s.trim();
  return trimmed === "" ? null : trimmed;
}

/** Raw (untrimmed) text of a cell; null when empty. Used where leading spaces matter. */
export function cellRawText(cell: ExcelJS.Cell, stats?: ReadStats): string | null {
  const v = cellScalar(cell, stats);
  if (v === null) return null;
  const s = typeof v === "string" ? v : String(v);
  return s === "" ? null : s;
}

/** Number of a cell; null when empty; throws when the cell holds text that is not a number. */
export function cellNumber(cell: ExcelJS.Cell, stats?: ReadStats): number | null {
  const v = cellScalar(cell, stats);
  if (v === null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n)) throw new Error(`Cell ${cell.address} is not a number: "${v}"`);
  return n;
}

/** Integer of a cell (used for row references and counts); null when empty or not an integer. */
export function cellInteger(cell: ExcelJS.Cell, stats?: ReadStats): number | null {
  const v = cellScalar(cell, stats);
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isInteger(n) ? n : null;
}

/** Calendar date of a cell as "YYYY-MM-DD"; null when empty. */
export function cellDate(cell: ExcelJS.Cell, stats?: ReadStats): string | null {
  const v = cellScalar(cell, stats);
  if (v === null) return null;
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return dateToIso(d);
    throw new Error(`Cell ${cell.address} is not a date: "${v}"`);
  }
  if (typeof v === "number") {
    // Excel serial date (days since 1899-12-30).
    const ms = Math.round((v - 25569) * 86_400_000);
    return dateToIso(new Date(ms));
  }
  throw new Error(`Cell ${cell.address} is not a date`);
}

export async function openWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return wb;
}

export function requireSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(name);
  if (!ws)
    throw new Error(
      `The workbook has no sheet named "${name}" (it has: ${wb.worksheets.map((s) => s.name).join(", ")}).`,
    );
  return ws;
}

/** Cell by A1 address on a sheet ("E11"). */
export function cellAt(ws: ExcelJS.Worksheet, address: string): ExcelJS.Cell {
  return ws.getCell(address);
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}
