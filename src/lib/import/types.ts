/**
 * Shapes shared by the historical import (docs/DATA_SOURCES.md). Money is integer cents (bigint);
 * dates are "YYYY-MM-DD" strings; every line remembers the sheet row it came from.
 */

/** The two private source workbooks, by their file names in data/source/. */
export const WORKBOOK_A_FILE = "2019-2024_SREI_general-ledger_and_tax-worksheets.xlsx";
export const WORKBOOK_B_FILE = "2025_SREI-PLA_general-ledger_final-review-snapshot_2026-09-10.xlsx";

/** Source keys stored in transactions.source_file (stable even if the files are renamed on disk). */
export const SOURCE_A = WORKBOOK_A_FILE;
export const SOURCE_B = WORKBOOK_B_FILE;

export type BankNumber = "1101" | "1102" | "1103" | "1104";
export const BANK_NUMBERS: readonly BankNumber[] = ["1101", "1102", "1103", "1104"];

// ---------------------------------------------------------------------------
// Workbook A — 2019–2024 journal lines
// ---------------------------------------------------------------------------

export interface SourceLineA {
  /** Sheet row number (provenance). */
  row: number;
  /** Cached "Transaction #" (groups lines into entries). */
  txn: number;
  date: string;
  name: string | null;
  memo: string | null;
  accountNumber: string;
  accountLabel: string;
  className: string;
  /** As written in the sheet (may be negative — P0-1). */
  rawDebit: number;
  rawCredit: number;
  /** After normalisation: non-negative, at most one non-zero. */
  debitCents: bigint;
  creditCents: bigint;
  /** True when the sheet held a negative debit or credit that was moved to the other side. */
  normalised: boolean;
  /** True when the sheet's debit and credit were both zero or empty (the line carries no money). */
  isZero: boolean;
}

export type EntryKind = "BANK" | "JOURNAL" | "ADJUSTING";

export interface EntryA {
  txn: number;
  date: string;
  /** Lines that carry money, in sheet order. */
  lines: SourceLineA[];
  /** Zero-amount lines dropped from the entry (kept in a system note). */
  zeroLines: SourceLineA[];
  vendor: string | null;
  memo: string | null;
  /** Bank ledger accounts touched (1101 / 1102). */
  bankNumbers: BankNumber[];
  /** The bank account the entry ran through (1101 when a transfer touches both), or null for a journal. */
  primaryBank: BankNumber | null;
  kind: EntryKind;
  /** Every line is zero-amount: imported as a VOIDED placeholder with no lines (P0-3). */
  isVoidPlaceholder: boolean;
  /** Lines carry more than one date (the first line's date is used). */
  mixedDates: boolean;
  /** Σ debit − Σ credit after normalisation (must be 0). */
  imbalanceCents: bigint;
}

export interface WorkbookAExtract {
  file: string;
  sha256: string;
  lines: SourceLineA[];
  entries: EntryA[];
  firstDataRow: number;
  lastDataRow: number;
  formulaCellsWithoutCachedResult: number;
  formulaCellsWithoutCachedResultAddresses: string[];
  errorCells: number;
  /** Cells whose amount had more than two decimals (rounded half away from zero). */
  subCentAmounts: { row: number; column: "Debit" | "Credit"; value: number }[];
  /** The chart-of-accounts region of the sheet (columns Q–U), for the diff against the seed. */
  chartRegion: {
    parentGroup: string;
    number: string;
    name: string;
    type: string;
    subType: string;
    subType2: string;
  }[];
}

// ---------------------------------------------------------------------------
// Workbook B — 2025 single-line rows
// ---------------------------------------------------------------------------

export interface RowB {
  /** Column A "#" — the source row reference (unique; provenance and idempotency key). */
  ref: number;
  /** Sheet row number. */
  row: number;
  date: string;
  /** Signed cents: negative = money out. */
  amountCents: bigint;
  rawAmount: number;
  vendor: string;
  accountRaw: string;
  /** Null for the "(split - varies)" placeholder row. */
  accountNumber: string | null;
  className: string;
  bankRaw: string;
  bankNumber: BankNumber;
  bankDescription: string | null;
  /** Column L "Ledger note" → System note (trimmed). */
  ledgerNote: string | null;
  /** Column M "My notes / answer" → User note (trimmed). */
  userNote: string | null;
  rowId: string | null;
  receipts: number;
  filledInBy: string | null;
  verifiedByOwner: boolean;
  needsModelSplit: boolean;
  isSplitPlaceholder: boolean;
  status: string | null;
  readiness: string | null;
}

export interface WorkbookBExtract {
  file: string;
  sha256: string;
  rows: RowB[];
  firstDataRow: number;
  lastDataRow: number;
  /** The first sheet row (after the data) whose "#" is not an integer — where the reader stopped. */
  stoppedAtRow: number | null;
  formulaCellsWithoutCachedResult: number;
  errorCells: number;
  subCentAmounts: { row: number; value: number }[];
  questionsForJose: {
    group: string;
    number: string;
    question: string;
    amount: string;
    date: string;
    why: string;
  }[];
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export interface Check {
  group: string;
  label: string;
  expected: string;
  actual: string;
  ok: boolean;
  /** Critical checks stop the import before anything is written; informational ones only appear in the report. */
  critical: boolean;
  note?: string;
}

export function cents(n: bigint): string {
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const body = `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac.toString().padStart(2, "0")}`;
  return negative ? `−${body}` : body;
}

export function centsFromDecimalString(s: string): bigint {
  const m = s.trim().match(/^(−|-)?\$?([\d,]*)(?:\.(\d+))?$/);
  if (!m) throw new Error(`Not an amount: ${s}`);
  const negative = !!m[1];
  const whole = BigInt((m[2] ?? "0").replace(/,/g, "") || "0");
  const fracRaw = (m[3] ?? "").padEnd(2, "0");
  if (fracRaw.length > 2 && Number(fracRaw.slice(2)) !== 0)
    throw new Error(`Amount has more than two decimals: ${s}`);
  const value = whole * 100n + BigInt(fracRaw.slice(0, 2));
  return negative ? -value : value;
}
