/**
 * The "simple row" the users already know (date · vendor · amount · account · class · bank account) and
 * its translation into journal lines, per DATA_SOURCES.md:
 *
 *   amount < 0 (money out) → Dr account |amount|, Cr bank |amount|
 *   amount > 0 (money in)  → Dr bank amount,      Cr account amount
 *
 * This is right for every account type (a −500 to 3102 Capital Distribution is Dr 3102 / Cr bank; a
 * +1,000 to 3101 is Dr bank / Cr 3101; a security deposit received is Dr bank / Cr 2101).
 *
 * Bank lines are *derived*: for a bank-centric transaction the app regenerates them from the other lines,
 * one bank line per class (so each class balances on its own and the per-class "Bank" column the workbook
 * reconciliation uses stays meaningful). Pure module: no database access.
 */
import { LedgerError } from "./errors";

export interface UserLine {
  accountId: string;
  classId: string;
  debitCents: bigint;
  creditCents: bigint;
  memo?: string | null;
}

export interface SimpleRow {
  /** Signed cents: negative = money out of the bank, positive = money in. */
  amountCents: bigint;
  accountId: string;
  classId: string;
  memo?: string | null;
}

/** The non-bank ("primary") line of a simple row. */
export function simpleRowToPrimaryLine(row: SimpleRow): UserLine {
  if (row.amountCents === 0n) throw new LedgerError("The amount cannot be zero.");
  const abs = row.amountCents < 0n ? -row.amountCents : row.amountCents;
  return row.amountCents < 0n
    ? {
        accountId: row.accountId,
        classId: row.classId,
        debitCents: abs,
        creditCents: 0n,
        memo: row.memo ?? null,
      }
    : {
        accountId: row.accountId,
        classId: row.classId,
        debitCents: 0n,
        creditCents: abs,
        memo: row.memo ?? null,
      };
}

/**
 * Bank lines for a bank-centric transaction, derived from its non-bank lines: one per class, on the
 * opposite side, so the transaction (and each class) balances. Lines that net to zero for a class are
 * skipped.
 */
export function deriveBankLines(
  nonBankLines: readonly { classId: string | null; debitCents: bigint; creditCents: bigint }[],
  bankLedgerAccountId: string,
): { accountId: string; classId: string | null; debitCents: bigint; creditCents: bigint }[] {
  const byClass = new Map<string | null, bigint>();
  const order: (string | null)[] = [];
  for (const l of nonBankLines) {
    if (!byClass.has(l.classId)) order.push(l.classId);
    byClass.set(l.classId, (byClass.get(l.classId) ?? 0n) + l.debitCents - l.creditCents);
  }
  const out = [];
  for (const classId of order) {
    const net = byClass.get(classId) ?? 0n;
    if (net === 0n) continue;
    out.push({
      accountId: bankLedgerAccountId,
      classId,
      debitCents: net < 0n ? -net : 0n,
      creditCents: net > 0n ? net : 0n,
    });
  }
  return out;
}

/**
 * The signed amount of a bank-centric transaction from the bank's point of view: Σ bank debits − Σ bank
 * credits (money in positive, money out negative). For a journal with no bank line, returns null.
 */
export function bankAmount(
  lines: readonly { accountId: string | null; debitCents: bigint; creditCents: bigint }[],
  isBankAccount: (accountId: string | null) => boolean,
): bigint | null {
  let found = false;
  let total = 0n;
  for (const l of lines) {
    if (!isBankAccount(l.accountId)) continue;
    found = true;
    total += l.debitCents - l.creditCents;
  }
  return found ? total : null;
}

/** Sum of debits of a set of lines (the natural "size" of a journal entry with no bank side). */
export function totalDebits(lines: readonly { debitCents: bigint }[]): bigint {
  let t = 0n;
  for (const l of lines) t += l.debitCents;
  return t;
}
