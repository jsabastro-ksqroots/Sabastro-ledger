/**
 * Money helpers. Amounts are integer cents (bigint) everywhere except at the very edge (display / input).
 */

export type NegativeStyle = "parens" | "minus";

export interface FormatOptions {
  negative?: NegativeStyle;
  /** Prefix with "$". Default false (tables show a column header instead). */
  symbol?: boolean;
  /** Show "—" for zero instead of 0.00. Default false. */
  dashForZero?: boolean;
}

const groupThousands = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function formatCents(cents: bigint | number, opts: FormatOptions = {}): string {
  const value = typeof cents === "bigint" ? cents : BigInt(Math.trunc(cents));
  if (value === 0n && opts.dashForZero) return "—";
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const body = `${opts.symbol ? "$" : ""}${groupThousands(whole.toString())}.${frac.toString().padStart(2, "0")}`;
  if (!negative) return body;
  return (opts.negative ?? "parens") === "parens" ? `(${body})` : `-${body}`;
}

/**
 * Parses user input such as "1,234.56", "$1,234.56", "(12.00)", "-12", "12.5", "12.345" (rounded half away from zero).
 * Returns null when the input is not a number.
 */
export function parseAmountToCents(input: string): bigint | null {
  let s = input.trim();
  if (s === "") return null;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  s = s.replace(/^\$/, "").replace(/,/g, "").trim();
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") return null;
  const [wholeRaw = "", fracRaw = ""] = s.split(".");
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  let cents = BigInt(whole) * 100n;
  if (fracRaw.length > 0) {
    const first2 = fracRaw.slice(0, 2).padEnd(2, "0");
    cents += BigInt(first2);
    const rest = fracRaw.slice(2);
    if (rest.length > 0 && Number(rest[0]) >= 5) cents += 1n;
  }
  return negative ? -cents : cents;
}

/** Converts a decimal number from a spreadsheet (e.g. 135.15) into cents, rounding half away from zero. */
export function decimalToCents(value: number | string): bigint {
  const str = typeof value === "number" ? value.toFixed(6) : value;
  const parsed = parseAmountToCents(str);
  if (parsed === null) throw new Error(`Not a valid amount: ${String(value)}`);
  return parsed;
}

export function sumCents(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

/**
 * Splits `total` cents across shares expressed in basis points (must sum to 10,000).
 * Each share is floored; the rounding remainder (always a few cents) goes to `remainderIndex`.
 * The parts always sum exactly to `total`.
 */
export function splitByBasisPoints(
  total: bigint,
  sharesBp: number[],
  remainderIndex: number,
): bigint[] {
  const sum = sharesBp.reduce((a, b) => a + b, 0);
  if (sum !== 10_000) throw new Error(`Shares must total 10,000 basis points, got ${sum}`);
  if (remainderIndex < 0 || remainderIndex >= sharesBp.length)
    throw new Error("Invalid remainder index");
  const sign = total < 0n ? -1n : 1n;
  const abs = total < 0n ? -total : total;
  const parts = sharesBp.map((bp) => (abs * BigInt(bp)) / 10_000n);
  const allocated = parts.reduce((a, b) => a + b, 0n);
  parts[remainderIndex] = (parts[remainderIndex] as bigint) + (abs - allocated);
  return parts.map((p) => p * sign);
}
