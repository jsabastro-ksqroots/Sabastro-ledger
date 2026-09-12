import { describe, expect, it } from "vitest";
import {
  decimalToCents,
  formatCents,
  parseAmountToCents,
  splitByBasisPoints,
  sumCents,
} from "@/lib/money";

describe("formatCents", () => {
  it("formats with thousands separators and two decimals", () => {
    expect(formatCents(123456789n)).toBe("1,234,567.89");
    expect(formatCents(5n)).toBe("0.05");
    expect(formatCents(0n)).toBe("0.00");
  });
  it("shows negatives in parentheses by default and with a minus on request", () => {
    expect(formatCents(-13515n)).toBe("(135.15)");
    expect(formatCents(-13515n, { negative: "minus" })).toBe("-135.15");
    expect(formatCents(-13515n, { symbol: true })).toBe("($135.15)");
  });
});

describe("parseAmountToCents", () => {
  it("parses common bookkeeping inputs", () => {
    expect(parseAmountToCents("1,234.56")).toBe(123456n);
    expect(parseAmountToCents("$1,234.56")).toBe(123456n);
    expect(parseAmountToCents("(12.00)")).toBe(-1200n);
    expect(parseAmountToCents("-12")).toBe(-1200n);
    expect(parseAmountToCents("12.5")).toBe(1250n);
    expect(parseAmountToCents(".5")).toBe(50n);
  });
  it("rounds a third decimal half away from zero", () => {
    expect(parseAmountToCents("12.345")).toBe(1235n);
    expect(parseAmountToCents("-12.345")).toBe(-1235n);
    expect(parseAmountToCents("12.344")).toBe(1234n);
  });
  it("rejects garbage", () => {
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("1.2.3")).toBeNull();
  });
});

describe("decimalToCents", () => {
  it("handles floating point spreadsheet values exactly", () => {
    expect(decimalToCents(135.15)).toBe(13515n);
    expect(decimalToCents(-7804.25)).toBe(-780425n);
    expect(decimalToCents(10891.949999999975)).toBe(1089195n);
    expect(decimalToCents(0.1 + 0.2)).toBe(30n);
  });
});

describe("splitByBasisPoints", () => {
  it("splits to the cent and gives the remainder to the designated target", () => {
    const parts = splitByBasisPoints(10000n, [3333, 3333, 3334], 2);
    expect(parts).toEqual([3333n, 3333n, 3334n]);
    expect(sumCents(parts)).toBe(10000n);
    const uneven = splitByBasisPoints(100n, [3333, 3333, 3334], 0);
    expect(sumCents(uneven)).toBe(100n);
    expect(uneven).toEqual([34n, 33n, 33n]);
  });
  it("keeps the sign of negative totals", () => {
    const parts = splitByBasisPoints(-101n, [5000, 5000], 1);
    expect(parts).toEqual([-50n, -51n]);
    expect(sumCents(parts)).toBe(-101n);
  });
  it("rejects shares that do not total 100 %", () => {
    expect(() => splitByBasisPoints(100n, [5000, 4000], 0)).toThrow();
  });
});
