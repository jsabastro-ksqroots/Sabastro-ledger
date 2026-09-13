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
  type SubGroupA,
  type WorkbookAExtract,
} from "./types";

/**
 * Reader for Workbook A (2019–2024, true double-entry). Region 1 of the "General Ledger" sheet: columns
 * B–O, header in row 2, data from row 3, grouped by the cached "Transaction #". Nothing is "improved":
 * the account numbers, classes, names and memos come through exactly as written. The only
 * transformations are the ones DECISIONS P0-1 and P0-3 require: a negative debit becomes a positive
 * credit (and vice-versa), and a zero-amount line carries no money.
 *
 * The workbook's Transaction # is a running-balance formula, so a few numbers cover two bookings
 * (DECISIONS P2-3): the entry is kept together, and its header comes from the bank movement.
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

/**
 * Decides how an entry is stored: through a bank account, or as a (year-end / depreciation) journal.
 * An entry whose every money line sits on one bank account (a payment and its reversal) is a journal
 * too, so both lines stay visible instead of being treated as the derived bank side.
 */
export function classifyEntry(
  bankNumbers: BankNumber[],
  date: string,
  accountNumbers: string[],
): { kind: EntryKind; primaryBank: BankNumber | null } {
  const allOnOneBank =
    accountNumbers.length > 0 && bankNumbers.length === 1 && accountNumbers.every(isBankNumber);
  if (bankNumbers.length > 0 && !allOnOneBank) {
    const primary = bankNumbers.includes("1101") ? "1101" : (bankNumbers[0] as BankNumber);
    return { kind: "BANK", primaryBank: primary };
  }
  if (allOnOneBank) return { kind: "JOURNAL", primaryBank: null };
  const touchesDepreciation = accountNumbers.some((n) => DEPRECIATION_ACCOUNTS.has(n));
  const yearEnd = date.endsWith("-12-31");
  return { kind: touchesDepreciation || yearEnd ? "ADJUSTING" : "JOURNAL", primaryBank: null };
}

/** Cuts the money lines of one entry wherever the running debit − credit balance returns to zero. */
export function subGroupsOf(money: readonly SourceLineA[]): SubGroupA[] {
  const groups: SubGroupA[] = [];
  let cur: SourceLineA[] = [];
  let balance = 0n;
  const flush = () => {
    if (cur.length === 0) return;
    const nonBank = cur.filter((l) => !isBankNumber(l.accountNumber));
    groups.push({
      firstRow: cur[0]?.row ?? 0,
      lastRow: cur[cur.length - 1]?.row ?? 0,
      dates: [...new Set(cur.map((l) => l.date))].sort(),
      name: cur.find((l) => l.name)?.name ?? null,
      memo: cur.find((l) => l.memo)?.memo ?? null,
      touchesBank: cur.some((l) => isBankNumber(l.accountNumber)),
      totalCents: cur.reduce((t, l) => t + l.debitCents, 0n),
      accounts: (nonBank.length ? nonBank : cur)
        .slice(0, 2)
        .map((l) => `${l.accountLabel} · ${l.className}`),
    });
    cur = [];
  };
  for (const l of money) {
    cur.push(l);
    balance += l.debitCents - l.creditCents;
    if (balance === 0n) flush();
  }
  flush(); // an unbalanced tail (never happens in a balanced workbook) still counts as a group
  return groups;
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
    const subGroups = subGroupsOf(money);
    const bankGroups = subGroups.filter((g) => g.touchesBank);
    const isMerged =
      subGroups.length >= 2 && bankGroups.length === 1 && subGroups.some((g) => !g.touchesBank);
    // The header describes what the users will see as the row: the bank movement when the workbook
    // lumped a non-cash booking with it, otherwise the whole entry.
    const headerLines = isMerged
      ? money.filter(
          (l) =>
            l.row >= (bankGroups[0] as SubGroupA).firstRow &&
            l.row <= (bankGroups[0] as SubGroupA).lastRow,
        )
      : all;
    const dates = [...new Set(all.map((l) => l.date))];
    const date =
      [...new Set(headerLines.map((l) => l.date))].sort()[0] ?? (all[0] as SourceLineA).date;
    // A zero-amount placeholder (P0-3) keeps the bank its zero lines named, so it sits in that bank's ledger.
    const source = money.length > 0 ? money : all;
    const bankNumbers = [
      ...new Set(source.map((l) => l.accountNumber).filter(isBankNumber)),
    ] as BankNumber[];
    const { kind, primaryBank } = classifyEntry(
      bankNumbers,
      date,
      source.map((l) => l.accountNumber),
    );
    const isSelfCancelling =
      money.length > 0 &&
      bankNumbers.length === 1 &&
      money.every((l) => isBankNumber(l.accountNumber));
    let imbalance = 0n;
    for (const l of money) imbalance += l.debitCents - l.creditCents;
    entries.push({
      txn,
      date,
      lines: money,
      zeroLines: zero,
      vendor: headerLines.find((l) => l.name)?.name ?? all.find((l) => l.name)?.name ?? null,
      memo: headerLines.find((l) => l.memo)?.memo ?? all.find((l) => l.memo)?.memo ?? null,
      bankNumbers,
      primaryBank,
      kind,
      isVoidPlaceholder: money.length === 0,
      mixedDates: dates.length > 1,
      subGroups,
      isMerged,
      isSelfCancelling,
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
