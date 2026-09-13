/**
 * Manual split math. A split replaces one line with several account/class lines on the same side that
 * add up to it exactly. Parts can be given as amounts (must sum to the original) or as percentages
 * (must total 100.00 %; cents are split with the rounding remainder going to the largest share so the
 * parts always sum exactly). Pure module: no database access.
 */
import { formatCents, splitByBasisPoints } from "@/lib/money";
import { LedgerError } from "./errors";

export interface SplitPartInput {
  accountId: string;
  classId: string;
  /** Used in "amount" mode: positive cents. */
  amountCents?: bigint | null;
  /** Used in "percent" mode: basis points (33.33 % = 3333). */
  percentBp?: number | null;
  memo?: string | null;
}

export interface SplitPart {
  accountId: string;
  classId: string;
  amountCents: bigint;
  memo: string | null;
}

export type SplitMode = "amount" | "percent";

/** "33.33" → 3333 basis points; null when the text is not a percentage. Up to two decimals. */
export function parsePercentToBp(input: string): number | null {
  const s = input.trim().replace(/%$/, "").trim();
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function formatBp(bp: number): string {
  return `${(bp / 100).toFixed(2)}%`;
}

/**
 * Validates the parts and returns the exact cent amounts. `totalCents` is the magnitude of the line being
 * split (always positive; the side is kept by the caller).
 */
export function computeSplit(
  totalCents: bigint,
  parts: readonly SplitPartInput[],
  mode: SplitMode,
): SplitPart[] {
  if (totalCents <= 0n) throw new LedgerError("Only a line with an amount can be split.");
  if (parts.length < 2) throw new LedgerError("A split needs at least two lines.");
  for (const [i, p] of parts.entries()) {
    if (!p.accountId) throw new LedgerError(`Line ${i + 1} needs an account.`);
    if (!p.classId) throw new LedgerError(`Line ${i + 1} needs a class.`);
  }

  if (mode === "amount") {
    let sum = 0n;
    const out: SplitPart[] = parts.map((p, i) => {
      const amount = p.amountCents ?? 0n;
      if (amount <= 0n) throw new LedgerError(`Line ${i + 1} needs an amount greater than zero.`);
      sum += amount;
      return {
        accountId: p.accountId,
        classId: p.classId,
        amountCents: amount,
        memo: p.memo ?? null,
      };
    });
    if (sum !== totalCents) {
      const diff = totalCents - sum;
      throw new LedgerError(
        `The split lines add up to ${formatCents(sum)} but the line is ${formatCents(totalCents)} — ${
          diff > 0n ? `${formatCents(diff)} still to allocate` : `${formatCents(-diff)} too much`
        }.`,
      );
    }
    return out;
  }

  const bps = parts.map((p, i) => {
    const bp = p.percentBp ?? 0;
    if (!Number.isInteger(bp) || bp < 0)
      throw new LedgerError(`Line ${i + 1} needs a percentage between 0 and 100.`);
    return bp;
  });
  const sumBp = bps.reduce((a, b) => a + b, 0);
  if (sumBp !== 10_000)
    throw new LedgerError(
      `The percentages total ${formatBp(sumBp)}; they must total exactly 100.00%.`,
    );
  let remainderIndex = 0;
  bps.forEach((bp, i) => {
    if (bp > (bps[remainderIndex] as number)) remainderIndex = i;
  });
  const amounts = splitByBasisPoints(totalCents, bps, remainderIndex);
  return parts.map((p, i) => {
    const amountCents = amounts[i] as bigint;
    if (amountCents <= 0n)
      throw new LedgerError(
        `Line ${i + 1} would get ${formatCents(amountCents)} — every split line needs at least one cent.`,
      );
    return { accountId: p.accountId, classId: p.classId, amountCents, memo: p.memo ?? null };
  });
}
