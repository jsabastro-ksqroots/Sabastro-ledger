import { decimalToCents } from "@/lib/money";
import {
  cellDate,
  cellInteger,
  cellNumber,
  cellText,
  newReadStats,
  openWorkbook,
  requireSheet,
  sha256File,
} from "./xlsx";
import { parseAccountLabel } from "./workbook-a";
import { SOURCE_B, type BankNumber, type RowB, type WorkbookBExtract } from "./types";

/**
 * Reader for Workbook B (the 2025 snapshot: one bank-centric row per transaction). Sheet "Transactions",
 * header row 1, data from row 2 until the first row whose "#" is not an integer (two trailer rows sit
 * below the table). The single-row → two-line rule and every quirk in DATA_SOURCES.md are applied by the
 * loader; this module only reads faithfully.
 */

const SHEET = "Transactions";
const HEADER_ROW = 1;
const FIRST_DATA_ROW = 2;
const COL = {
  ref: 1,
  date: 2,
  amount: 3,
  vendor: 4,
  status: 5,
  readiness: 6,
  checked: 7,
  account: 8,
  class: 9,
  bank: 10,
  description: 11,
  ledgerNote: 12,
  userNote: 13,
  rowId: 14,
  receipts: 15,
  filledInBy: 16,
} as const;
const EXPECTED_HEADERS: Record<number, string> = {
  1: "#",
  2: "Date",
  3: "Amount",
  4: "Vendor",
  5: "Status",
  6: "Readiness",
  8: "Account",
  9: "Class",
  10: "Bank account",
  11: "Full bank description",
  12: "Ledger note",
  13: "My notes / answer",
  14: "Row ID",
  15: "Receipts",
  16: "Filled in by",
};

/** Column J values → the seed's bank ledger account numbers (Venmo is 1104, decision D4). */
export const BANK_BY_LABEL: Record<string, BankNumber> = {
  "Real Estate (1101)": "1101",
  "PLA (1103)": "1103",
  Venmo: "1104",
};
export const SPLIT_PLACEHOLDER = "(split - varies)";
/** Rows "unsplit back to General" on 2026-09-10 (DATA_SOURCES quirk 5, matched on the TRIMMED note, P0-5). */
export const UNSPLIT_NOTE_PREFIX = "[Unsplit 2026-09-10";

export function isVerifiedByOwner(filledInBy: string | null): boolean {
  return !!filledInBy && filledInBy.startsWith("Jose");
}

export async function extractWorkbookB(path: string): Promise<WorkbookBExtract> {
  const [wb, sha256] = await Promise.all([openWorkbook(path), sha256File(path)]);
  const ws = requireSheet(wb, SHEET);
  const stats = newReadStats();

  const header = ws.getRow(HEADER_ROW);
  for (const [col, expected] of Object.entries(EXPECTED_HEADERS)) {
    const found = cellText(header.getCell(Number(col)), stats);
    if (found !== expected)
      throw new Error(
        `Workbook B: expected header "${expected}" in column ${col}, found "${found ?? ""}". The layout has changed; stopping.`,
      );
  }

  const rows: RowB[] = [];
  const subCentAmounts: WorkbookBExtract["subCentAmounts"] = [];
  let r = FIRST_DATA_ROW;
  let last = FIRST_DATA_ROW - 1;
  let stoppedAt: number | null = null;
  for (;;) {
    const row = ws.getRow(r);
    const ref = cellInteger(row.getCell(COL.ref), stats);
    if (ref === null) {
      stoppedAt = r;
      break;
    }
    const where = `Workbook B row ${r} (#${ref})`;
    const date = cellDate(row.getCell(COL.date), stats);
    if (!date) throw new Error(`${where}: the date is empty.`);
    const rawAmount = cellNumber(row.getCell(COL.amount), stats);
    if (rawAmount === null || rawAmount === 0)
      throw new Error(`${where}: the amount is empty or zero; a row must move money.`);
    if (Math.abs(rawAmount * 100 - Math.round(rawAmount * 100)) > 1e-6)
      subCentAmounts.push({ row: r, value: rawAmount });
    const vendor = cellText(row.getCell(COL.vendor), stats);
    if (!vendor) throw new Error(`${where}: the vendor is empty.`);
    const accountRaw = cellText(row.getCell(COL.account), stats);
    if (!accountRaw) throw new Error(`${where}: the account is empty.`);
    const isSplitPlaceholder = accountRaw === SPLIT_PLACEHOLDER;
    const accountNumber = isSplitPlaceholder ? null : parseAccountLabel(accountRaw).number;
    const className = cellText(row.getCell(COL.class), stats);
    if (!className) throw new Error(`${where}: the class is empty.`);
    const bankRaw = cellText(row.getCell(COL.bank), stats);
    const bankNumber = bankRaw ? BANK_BY_LABEL[bankRaw] : undefined;
    if (!bankRaw || !bankNumber)
      throw new Error(
        `${where}: unknown bank account "${bankRaw ?? ""}" (expected one of ${Object.keys(BANK_BY_LABEL).join(", ")}).`,
      );
    const ledgerNote = cellText(row.getCell(COL.ledgerNote), stats);
    const filledInBy = cellText(row.getCell(COL.filledInBy), stats);
    rows.push({
      ref,
      row: r,
      date,
      amountCents: decimalToCents(rawAmount),
      rawAmount,
      vendor,
      accountRaw,
      accountNumber,
      className,
      bankRaw,
      bankNumber,
      bankDescription: cellText(row.getCell(COL.description), stats),
      ledgerNote,
      userNote: cellText(row.getCell(COL.userNote), stats),
      rowId: cellText(row.getCell(COL.rowId), stats),
      receipts: cellInteger(row.getCell(COL.receipts), stats) ?? 0,
      filledInBy,
      verifiedByOwner: isVerifiedByOwner(filledInBy),
      needsModelSplit: !!ledgerNote && ledgerNote.startsWith(UNSPLIT_NOTE_PREFIX),
      isSplitPlaceholder,
      status: cellText(row.getCell(COL.status), stats),
      readiness: cellText(row.getCell(COL.readiness), stats),
    });
    last = r;
    r++;
  }
  if (rows.length === 0) throw new Error("Workbook B: no rows were found.");

  const questionsForJose: WorkbookBExtract["questionsForJose"] = [];
  const qs = wb.getWorksheet("Questions for Jose");
  if (qs) {
    for (let qr = 2; qr < 200; qr++) {
      const row = qs.getRow(qr);
      const group = cellText(row.getCell(1), stats);
      const question = cellText(row.getCell(3), stats);
      if (!group && !question) break;
      questionsForJose.push({
        group: group ?? "",
        number: cellText(row.getCell(2), stats) ?? "",
        question: question ?? "",
        amount: cellText(row.getCell(4), stats) ?? "",
        date: cellDateOrText(row.getCell(5)),
        why: cellText(row.getCell(6), stats) ?? "",
      });
    }
  }

  return {
    file: SOURCE_B,
    sha256,
    rows,
    firstDataRow: FIRST_DATA_ROW,
    lastDataRow: last,
    stoppedAtRow: stoppedAt,
    formulaCellsWithoutCachedResult: stats.formulaCellsWithoutCachedResult,
    errorCells: stats.errorCells,
    subCentAmounts,
    questionsForJose,
  };

  function cellDateOrText(cell: Parameters<typeof cellText>[0]): string {
    try {
      return cellDate(cell, stats) ?? "";
    } catch {
      return cellText(cell, stats) ?? "";
    }
  }
}
