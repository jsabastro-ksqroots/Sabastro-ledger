import { describe, expect, it } from "vitest";
import { computeSplit, formatBp, parsePercentToBp } from "@/lib/ledger/split";
import { sumCents } from "@/lib/money";

describe("split by amount", () => {
  it("accepts parts that add up exactly and keeps their order", () => {
    const parts = computeSplit(
      10_000n,
      [
        { accountId: "a", classId: "x", amountCents: 6_000n },
        { accountId: "a", classId: "y", amountCents: 4_000n, memo: "shed share" },
      ],
      "amount",
    );
    expect(parts.map((p) => p.amountCents)).toEqual([6_000n, 4_000n]);
    expect(parts[1]?.memo).toBe("shed share");
  });

  it("rejects parts that do not add up, saying how much is missing or over", () => {
    expect(() =>
      computeSplit(
        10_000n,
        [
          { accountId: "a", classId: "x", amountCents: 6_000n },
          { accountId: "a", classId: "y", amountCents: 3_000n },
        ],
        "amount",
      ),
    ).toThrow(/10\.00 still to allocate/);
    expect(() =>
      computeSplit(
        10_000n,
        [
          { accountId: "a", classId: "x", amountCents: 6_000n },
          { accountId: "a", classId: "y", amountCents: 5_000n },
        ],
        "amount",
      ),
    ).toThrow(/10\.00 too much/);
  });

  it("needs at least two lines, positive amounts, an account and a class on each", () => {
    expect(() =>
      computeSplit(100n, [{ accountId: "a", classId: "x", amountCents: 100n }], "amount"),
    ).toThrow(/at least two/);
    expect(() =>
      computeSplit(
        100n,
        [
          { accountId: "a", classId: "x", amountCents: 100n },
          { accountId: "a", classId: "y", amountCents: 0n },
        ],
        "amount",
      ),
    ).toThrow(/greater than zero/);
    expect(() =>
      computeSplit(
        100n,
        [
          { accountId: "a", classId: "", amountCents: 50n },
          { accountId: "a", classId: "y", amountCents: 50n },
        ],
        "amount",
      ),
    ).toThrow(/needs a class/);
  });
});

describe("split by percent", () => {
  it("splits to the cent and gives the rounding remainder to the largest share", () => {
    const parts = computeSplit(
      10_001n,
      [
        { accountId: "a", classId: "x", percentBp: 3333 },
        { accountId: "a", classId: "y", percentBp: 3333 },
        { accountId: "a", classId: "z", percentBp: 3334 },
      ],
      "percent",
    );
    expect(sumCents(parts.map((p) => p.amountCents))).toBe(10_001n);
    // floor(10001 × 0.3333) = 3333, floor(10001 × 0.3334) = 3334, remainder 1 → the 33.34 % share
    expect(parts.map((p) => p.amountCents)).toEqual([3333n, 3333n, 3335n]);
  });

  it("uses the first largest share when shares tie", () => {
    const parts = computeSplit(
      101n,
      [
        { accountId: "a", classId: "x", percentBp: 5000 },
        { accountId: "a", classId: "y", percentBp: 5000 },
      ],
      "percent",
    );
    expect(parts.map((p) => p.amountCents)).toEqual([51n, 50n]);
  });

  it("rejects percentages that do not total 100.00 %", () => {
    expect(() =>
      computeSplit(
        100n,
        [
          { accountId: "a", classId: "x", percentBp: 5000 },
          { accountId: "a", classId: "y", percentBp: 4999 },
        ],
        "percent",
      ),
    ).toThrow(/total 99\.99%/);
  });

  it("rejects a share so small it would get zero cents", () => {
    expect(() =>
      computeSplit(
        100n,
        [
          { accountId: "a", classId: "x", percentBp: 9999 },
          { accountId: "a", classId: "y", percentBp: 1 },
        ],
        "percent",
      ),
    ).toThrow(/at least one cent/);
  });

  it("parses and formats percentages", () => {
    expect(parsePercentToBp("33.33")).toBe(3333);
    expect(parsePercentToBp("50")).toBe(5000);
    expect(parsePercentToBp("12.5%")).toBe(1250);
    expect(parsePercentToBp("abc")).toBeNull();
    expect(parsePercentToBp("1.234")).toBeNull();
    expect(formatBp(3334)).toBe("33.34%");
  });
});
