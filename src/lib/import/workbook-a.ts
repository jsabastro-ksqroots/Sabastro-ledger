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
import {
  BANK_NUMBERS,
  SOURCE_A,
  type BankNumber,
  type EntryA,
  type EntryKind,
  type SourceLineA,
  type WorkbookAExtract,
} from "./types";

/**
 * Reader for Workbook A (2019–2024, true double-entry). Region 1 of the "General Ledger" sheet: columns
 * B–O, header in row 2, data from row 3, grouped by the cached "Transaction #". Nothing is "improved":
 * the account numbers, classes, names and memos come through exactly as written. The only
 * transformations are the ones DECISIONS P0-1 and P0-3 require: a negative debit becomes a positive
 * credit (and vice-versa), and a zero-amount line carries no money.
 */

const SHEET = "General Ledger";
const HEADER_ROW = 2;
const FIRST_DATA_ROW = 3;
const COL = {
  txn: 2,
  date: 3,
  name: 4,
  memo: 5,
  account: 6,
  class: 7,
  debit: 8,
  credit: 9,
} as const;
const EXPECTED_HEADERS = [
  "Transaction #",
  "Date",
  "Name",
  "Memo",
  "Account",
  "Class",
  "Debit",
  "Credit",
];
const CHART_COL = { parent: 17, account: 18, type: 19, subType: 20, subType2: 21 } as const;

/** Accumulated-depreciation and depreciation-expense accounts: an entry touching them is an adjusting entry. */
export const DEPRECIATION_ACCOUNTS = new Set([
  "1303",
  "1305",
  "1307",
  "1309",
  "1311",
  "5301",
  "5302",
  "5303",
  "5304",
  "5305",
]);

export function parseAccountLabel(label: string): { number: string; name: string } {
  const m = label.trim().match(/^(\d{4})\s+(.+)$/);
  if (!m) throw new Error(`Account cell is not "NNNN Name": "${label}"`);
  return { number: m[1] as string, name: (m[2] as string).trim() };
}

function isBankNumber(n: string): n is BankNumber {
  return (BANK_NUMBERS as readonly string[]).includes(n);
}

function hasSubCent(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) > 1e-6;
}

/** Decides how an entry is stored: through a bank account, or as a (year-end / depreciation) journal. */
export function classifyEntry(
  bankNumbers: BankNumber[],
  date: string,
  accountNumbers: Iterable<string>,
): { kind: EntryKind; primaryBank: BankNumber | null } {
  if (bankNumbers.length > 0) {
    const primary = bankNumbers.includes("1101") ? "1101" : (bankNumbers[0] as BankNumber);
    return { kind: "BANK", primaryBank: primary };
  }
  const touchesDepreciation = [...accountNumbers].some((n) => DEPRECIATION_ACCOUNTS.has(n));
  const yearEnd = date.endsWith("-12-31");
  return { kind: touchesDepreciation || yearEnd ? "ADJUSTING" : "JOURNAL", primaryBank: null };
}

/** Groups normalised lines into entries. Pure, so tests can feed it hand-made lines. */
export function groupEntries(lines: readonly SourceLineA[]): EntryA[] {
  const byTxn = new Map<number, SourceLineA[]>();
  for (const l of lines) {
    const arr = byTxn.get(l.txn) ?? [];
    arr.push(l);
    byTxn.set(l.txn, arr);
  }
  const entries: EntryA[] = [];
  for (const [txn, all] of byTxn) {
    const money = all.filter((l) => !l.isZero);
    const zero = all.filter((l) => l.isZero);
    const dates = [...new Set(all.map((l) => l.date))];
    const first = all[0] as SourceLineA;
    // A zero-amount placeholder (P0-3) keeps the bank its zero lines named, so it sits in that bank's ledger.
    const source = money.length > 0 ? money : all;
    const bankNumbers = [
      ...new Set(source.map((l) => l.accountNumber).filter(isBankNumber)),
    ] as BankNumber[];
    const { kind, primaryBank } = classifyEntry(
      bankNumbers,
      first.date,
      source.map((l) => l.accountNumber),
    );
    let imbalance = 0n;
    for (const l of money) imbalance += l.debitCents - l.creditCents;
    entries.push({
      txn,
      date: first.date,
      lines: money,
      zeroLines: zero,
      vendor: all.find((l) => l.name)?.name ?? null,
      memo: all.find((l) => l.memo)?.memo ?? null,
      bankNumbers,
      primaryBank,
      kind,
      isVoidPlaceholder: money.length === 0,
      mixedDates: dates.length > 1,
      imbalanceCents: imbalance,
    });
  }
  return entries;
}

/** Normalises one sheet line (P0-1): non-negative debit/credit, at most one non-zero. */
export function normaliseAmounts(
  rawDebit: number,
  rawCredit: number,
  where: string,
): { debitCents: bigint; creditCents: bigint; normalised: boolean; isZero: boolean } {
  let debit = decimalToCents(rawDebit);
  let credit = decimalToCents(rawCredit);
  let normalised = false;
  if (debit < 0n) {
    credit += -debit;
    debit = 0n;
    normalised = true;
  }
  if (credit < 0n) {
    debit += -credit;
    credit = 0n;
    normalised = true;
  }
  if (debit > 0n && credit > 0n)
    throw new Error(
      `${where}: the line has both a debit (${rawDebit}) and a credit (${rawCredit}); the import does not net lines.`,
    );
  return {
    debitCents: debit,
    creditCents: credit,
    normalised,
    isZero: debit === 0n && credit === 0n,
  };
}

export async function extractWorkbookA(path: string): Promise<WorkbookAExtract> {
  const [wb, sha256] = await Promise.all([openWorkbook(path), sha256File(path)]);
  const ws = requireSheet(wb, SHEET);
  const stats = newReadStats();

  const header = ws.getRow(HEADER_ROW);
  const headers = EXPECTED_HEADERS.map((_, i) => cellText(header.getCell(COL.txn + i), stats));
  EXPECTED_HEADERS.forEach((expected, i) => {
    if (headers[i] !== expected)
      throw new Error(
        `Workbook A: expected header "${expected}" in column ${COL.txn + i} of row ${HEADER_ROW}, found "${headers[i] ?? ""}". The layout has changed; stopping.`,
      );
  });

  const lines: SourceLineA[] = [];
  const subCentAmounts: WorkbookAExtract["subCentAmounts"] = [];
  let r = FIRST_DATA_ROW;
  let last = FIRST_DATA_ROW - 1;
  for (;;) {
    const row = ws.getRow(r);
    const txn = cellInteger(row.getCell(COL.txn), stats);
    if (txn === null) break;
    const where = `Workbook A row ${r}`;
    const date = cellDate(row.getCell(COL.date), stats);
    if (!date) throw new Error(`${where}: the date is empty.`);
    const accountLabel = cellText(row.getCell(COL.account), stats);
    if (!accountLabel) throw new Error(`${where}: the account is empty.`);
    const { number: accountNumber } = parseAccountLabel(accountLabel);
    const className = cellText(row.getCell(COL.class), stats);
    if (!className) throw new Error(`${where}: the class is empty.`);
    const rawDebit = cellNumber(row.getCell(COL.debit), stats) ?? 0;
    const rawCredit = cellNumber(row.getCell(COL.credit), stats) ?? 0;
    if (hasSubCent(rawDebit)) subCentAmounts.push({ row: r, column: "Debit", value: rawDebit });
    if (hasSubCent(rawCredit)) subCentAmounts.push({ row: r, column: "Credit", value: rawCredit });
    const amounts = normaliseAmounts(rawDebit, rawCredit, where);
    lines.push({
      row: r,
      txn,
      date,
      name: cellText(row.getCell(COL.name), stats),
      memo: cellText(row.getCell(COL.memo), stats),
      accountNumber,
      accountLabel,
      className,
      rawDebit,
      rawCredit,
      ...amounts,
    });
    last = r;
    r++;
  }
  if (lines.length === 0) throw new Error("Workbook A: no journal lines were found.");

  const chartRegion: WorkbookAExtract["chartRegion"] = [];
  for (let cr = FIRST_DATA_ROW; cr < FIRST_DATA_ROW + 500; cr++) {
    const row = ws.getRow(cr);
    const label = cellText(row.getCell(CHART_COL.account), stats);
    if (!label) break;
    const { number, name } = parseAccountLabel(label);
    chartRegion.push({
      parentGroup: cellText(row.getCell(CHART_COL.parent), stats) ?? "",
      number,
      name,
      type: cellText(row.getCell(CHART_COL.type), stats) ?? "",
      subType: cellText(row.getCell(CHART_COL.subType), stats) ?? "",
      subType2: cellText(row.getCell(CHART_COL.subType2), stats) ?? "",
    });
  }

  return {
    file: SOURCE_A,
    sha256,
    lines,
    entries: groupEntries(lines),
    firstDataRow: FIRST_DATA_ROW,
    lastDataRow: last,
    formulaCellsWithoutCachedResult: stats.formulaCellsWithoutCachedResult,
    formulaCellsWithoutCachedResultAddresses: stats.formulaCellsWithoutCachedResultAddresses,
    errorCells: stats.errorCells,
    subCentAmounts,
    chartRegion,
  };
}
