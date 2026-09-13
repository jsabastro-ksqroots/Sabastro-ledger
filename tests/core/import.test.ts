import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, db, disconnectDb } from "@/lib/db";
import { runSeed } from "@/lib/seed/run-seed";
import {
  classifyEntry,
  groupEntries,
  normaliseAmounts,
  parseAccountLabel,
} from "@/lib/import/workbook-a";
import { extractWorkbookA } from "@/lib/import/workbook-a";
import { extractWorkbookB, isVerifiedByOwner, UNSPLIT_NOTE_PREFIX } from "@/lib/import/workbook-b";
import { isCrossEntityRow, sameDayGroups } from "@/lib/import/checklist";
import { checkPercentageSet, sharesToBasisPoints } from "@/lib/import/reference-models";
import {
  buildLookups,
  existingSourceRefs,
  insertPrepared,
  LOCK_OVERRIDE_REASON,
  prepareEntryA,
  prepareRowB,
  setLockOverride,
  ZERO_PLACEHOLDER_REASON,
} from "@/lib/import/load";
import { runImport, sourcePaths } from "@/lib/import/run";
import { liveLines, loadTransaction } from "@/lib/ledger/transactions";
import { SOURCE_A, SOURCE_B, type RowB, type SourceLineA } from "@/lib/import/types";

/**
 * The historical import: the pure rules (normalisation, grouping, kinds, shares), the loader against the
 * real database with the seed and the restricted role, and — when the private workbooks are on this
 * machine — the whole import twice (the second run must insert nothing).
 */

const owner = createPrismaClient(process.env.DATABASE_URL as string);
let actor: { userId: string; sessionId: null; ip: null; userAgent: string; displayName: string };

function line(
  p: Partial<SourceLineA> & { txn: number; row: number; accountNumber: string; className: string },
): SourceLineA {
  const rawDebit = p.rawDebit ?? 0;
  const rawCredit = p.rawCredit ?? 0;
  const amounts = normaliseAmounts(rawDebit, rawCredit, `row ${p.row}`);
  return {
    date: "2020-03-05",
    name: null,
    memo: null,
    accountLabel: `${p.accountNumber} Test`,
    rawDebit,
    rawCredit,
    ...amounts,
    ...p,
  };
}

function rowB(p: Partial<RowB> & { ref: number }): RowB {
  return {
    row: p.ref + 1,
    date: "2025-03-05",
    amountCents: -1000n,
    rawAmount: -10,
    vendor: "Test vendor",
    accountRaw: "5215 Supplies Expense",
    accountNumber: "5215",
    className: "General",
    bankRaw: "Real Estate (1101)",
    bankNumber: "1101",
    bankDescription: null,
    ledgerNote: null,
    userNote: null,
    rowId: null,
    receipts: 0,
    filledInBy: null,
    verifiedByOwner: false,
    needsModelSplit: false,
    isSplitPlaceholder: false,
    status: "Confirmed",
    readiness: "Ready",
    ...p,
  };
}

beforeAll(async () => {
  await runSeed(owner, { users: [], appDbPassword: null });
  const user = await owner.user.create({
    data: {
      email: `import-${Date.now()}@test.local`,
      displayName: "Import tester",
      passwordHash: "!test",
      role: "FULL",
    },
  });
  actor = {
    userId: user.id,
    sessionId: null,
    ip: null,
    userAgent: "vitest",
    displayName: user.displayName,
  };
});

afterAll(async () => {
  await disconnectDb();
  await owner.$disconnect();
});

describe("workbook A rules", () => {
  it("parses 'NNNN Name' account labels", () => {
    expect(parseAccountLabel("5204 Landscaping Expense")).toEqual({
      number: "5204",
      name: "Landscaping Expense",
    });
    expect(() => parseAccountLabel("(split - varies)")).toThrow();
  });

  it("moves a negative debit to the credit side and vice-versa (P0-1), never nets a two-sided line", () => {
    expect(normaliseAmounts(-3, 0, "x")).toMatchObject({
      debitCents: 0n,
      creditCents: 300n,
      normalised: true,
      isZero: false,
    });
    expect(normaliseAmounts(0, -21, "x")).toMatchObject({
      debitCents: 2100n,
      creditCents: 0n,
      normalised: true,
    });
    expect(normaliseAmounts(0, 0, "x")).toMatchObject({
      debitCents: 0n,
      creditCents: 0n,
      isZero: true,
    });
    expect(normaliseAmounts(174.42000000000007, 0, "x").debitCents).toBe(17442n);
    expect(() => normaliseAmounts(5, 3, "x")).toThrow(/both a debit .* and a credit/);
  });

  it("groups lines into entries and decides how each is stored", () => {
    const entries = groupEntries([
      line({
        txn: 1,
        row: 3,
        accountNumber: "1101",
        className: "General",
        rawCredit: 100,
        name: "Lowes",
      }),
      line({ txn: 1, row: 4, accountNumber: "5206", className: "Rentals:The Shed", rawDebit: 100 }),
      line({
        txn: 2,
        row: 5,
        accountNumber: "1101",
        className: "General",
        rawDebit: 2100,
        date: "2019-05-02",
      }),
      line({
        txn: 2,
        row: 6,
        accountNumber: "1102",
        className: "General",
        rawCredit: 2100,
        date: "2019-05-02",
      }),
      line({
        txn: 3,
        row: 7,
        accountNumber: "5301",
        className: "Rentals:The Shed",
        rawDebit: 50,
        date: "2020-12-31",
      }),
      line({
        txn: 3,
        row: 8,
        accountNumber: "1303",
        className: "Rentals:The Shed",
        rawCredit: 50,
        date: "2020-12-31",
      }),
      line({
        txn: 4,
        row: 9,
        accountNumber: "2101",
        className: "Rentals:The Shed",
        rawDebit: 900,
        date: "2020-06-01",
      }),
      line({
        txn: 4,
        row: 10,
        accountNumber: "4101",
        className: "Rentals:The Shed",
        rawCredit: 900,
        date: "2020-06-01",
      }),
      line({
        txn: 5,
        row: 11,
        accountNumber: "5212",
        className: "General",
        rawDebit: 0,
        name: "Bank of America",
        date: "2024-07-12",
      }),
      line({
        txn: 6,
        row: 12,
        accountNumber: "4101",
        className: "Rentals:The Clubhouse",
        rawCredit: 3000,
        date: "2024-01-01",
      }),
      line({
        txn: 6,
        row: 13,
        accountNumber: "1101",
        className: "Rentals:The Clubhouse",
        rawDebit: 3000,
        date: "2024-01-02",
      }),
      // The workbook's running-balance numbering lumps a non-cash rent booking with the next bank item.
      line({
        txn: 7,
        row: 14,
        accountNumber: "4101",
        className: "Rentals:The Clubhouse",
        rawCredit: 3000,
        date: "2024-03-01",
        name: "Sabastro Consulting",
        memo: "Rent for the Consulting Business",
      }),
      line({
        txn: 7,
        row: 15,
        accountNumber: "3102",
        className: "Rentals:The Clubhouse",
        rawDebit: 3000,
        date: "2024-03-01",
        name: "Sabastro Consulting",
      }),
      line({
        txn: 7,
        row: 16,
        accountNumber: "5214",
        className: "General",
        rawDebit: 16.95,
        date: "2024-03-02",
        name: "Zoom",
        memo: "ZOOM.US",
      }),
      line({
        txn: 7,
        row: 17,
        accountNumber: "1101",
        className: "General",
        rawCredit: 16.95,
        date: "2024-03-02",
        name: "Zoom",
      }),
      // A payment and its reversal on the same bank account.
      line({
        txn: 8,
        row: 18,
        accountNumber: "1101",
        className: "General",
        rawDebit: 25000,
        date: "2020-06-01",
        name: "John Boxler",
      }),
      line({
        txn: 8,
        row: 19,
        accountNumber: "1101",
        className: "General",
        rawCredit: 25000,
        date: "2020-06-01",
        name: "John Boxler",
      }),
    ]);
    expect(entries.map((e) => e.txn)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(entries[0]).toMatchObject({
      kind: "BANK",
      primaryBank: "1101",
      vendor: "Lowes",
      imbalanceCents: 0n,
    });
    expect(entries[1]).toMatchObject({
      kind: "BANK",
      primaryBank: "1101",
      bankNumbers: ["1101", "1102"],
    });
    expect(entries[2]).toMatchObject({ kind: "ADJUSTING", primaryBank: null });
    expect(entries[3]).toMatchObject({ kind: "JOURNAL", primaryBank: null });
    // A placeholder keeps the bank of its 0.00 line only when that line IS a bank line (two of the four
    // real ones are on 1101, two on 5212 Bank Fees); this one is on 5212, so it is a journal-kind void.
    expect(entries[4]).toMatchObject({
      isVoidPlaceholder: true,
      kind: "JOURNAL",
      primaryBank: null,
      lines: [],
    });
    expect(entries[4]?.zeroLines).toHaveLength(1);
    expect(entries[5]).toMatchObject({ mixedDates: true, date: "2024-01-01", isMerged: false });
    expect(entries[6]).toMatchObject({
      isMerged: true,
      vendor: "Zoom",
      memo: "ZOOM.US",
      date: "2024-03-02",
      kind: "BANK",
      primaryBank: "1101",
    });
    expect(entries[6]?.subGroups.map((g) => g.touchesBank)).toEqual([false, true]);
    expect(entries[6]?.subGroups[0]).toMatchObject({
      name: "Sabastro Consulting",
      totalCents: 300000n,
      firstRow: 14,
      lastRow: 15,
    });
    expect(entries[7]).toMatchObject({
      isSelfCancelling: true,
      kind: "JOURNAL",
      primaryBank: null,
      vendor: "John Boxler",
    });
    expect(classifyEntry([], "2021-12-31", ["5204"])).toEqual({
      kind: "ADJUSTING",
      primaryBank: null,
    });
    expect(classifyEntry(["1102"], "2019-04-01", ["1102", "3101"])).toEqual({
      kind: "BANK",
      primaryBank: "1102",
    });
  });
});

describe("workbook B rules", () => {
  it("recognises Jose's rows, unsplit rows, cross-entity rows and same-day duplicates", () => {
    expect(isVerifiedByOwner("Jose's worksheet")).toBe(true);
    expect(isVerifiedByOwner("Emilio texts")).toBe(false);
    expect(isVerifiedByOwner(null)).toBe(false);
    expect(UNSPLIT_NOTE_PREFIX).toBe("[Unsplit 2026-09-10");
    expect(isCrossEntityRow(rowB({ ref: 1, className: "Providence", bankNumber: "1101" }))).toBe(
      true,
    );
    expect(isCrossEntityRow(rowB({ ref: 2, className: "Providence", bankNumber: "1104" }))).toBe(
      true,
    );
    expect(isCrossEntityRow(rowB({ ref: 3, className: "Providence", bankNumber: "1103" }))).toBe(
      false,
    );
    expect(isCrossEntityRow(rowB({ ref: 4, className: "General", bankNumber: "1103" }))).toBe(
      false,
    );
    expect(
      isCrossEntityRow(rowB({ ref: 5, className: "Rentals:The Shed", bankNumber: "1103" })),
    ).toBe(true);
    const groups = sameDayGroups([
      rowB({ ref: 10, vendor: "McGovern", amountCents: -13515n }),
      rowB({ ref: 11, vendor: "McGovern", amountCents: -13515n }),
      rowB({ ref: 12, vendor: "Someone else", amountCents: -13515n }),
      rowB({ ref: 13, vendor: "McGovern", amountCents: -15115n }),
      rowB({ ref: 14, vendor: "McGovern", amountCents: -13515n, bankNumber: "1103" }),
    ]);
    expect(groups.map((g) => g.map((r) => r.ref))).toEqual([[10, 11, 12]]);
  });
});

describe("the readers on small workbooks built here (no private files needed)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "sabastro-import-test-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a 2019–2024 style sheet: cached formulas, negative amounts, a zero placeholder, a merged entry", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("General Ledger");
    ws.getCell("B2").value = "Transaction #";
    ["Date", "Name", "Memo", "Account", "Class", "Debit", "Credit"].forEach(
      (h, i) => (ws.getCell(2, 3 + i).value = h),
    );
    const rows: (string | number | Date | null)[][] = [
      [
        1,
        new Date(Date.UTC(2020, 2, 5)),
        "Lowes",
        "LOWES #02405",
        "1101 Bank of America Checking Account",
        "Rentals:The Shed",
        0,
        100,
      ],
      [
        1,
        new Date(Date.UTC(2020, 2, 5)),
        "Lowes",
        "LOWES #02405",
        "5206 Repairs and Maintenance Expense",
        "Rentals:The Shed",
        100,
        0,
      ],
      [
        2,
        new Date(Date.UTC(2023, 11, 31)),
        null,
        "Reallocation",
        "5204 Landscaping Expense",
        "General",
        -3,
        0,
      ],
      [
        2,
        new Date(Date.UTC(2023, 11, 31)),
        null,
        "Reallocation",
        "5204 Landscaping Expense",
        "Rentals:The Shed",
        3,
        0,
      ],
      [
        3,
        new Date(Date.UTC(2024, 6, 12)),
        "Bank of America",
        null,
        "5212 Bank Fees",
        "General",
        0,
        0,
      ],
      [
        4,
        new Date(Date.UTC(2024, 0, 1)),
        "Sabastro Consulting",
        "Rent",
        "4101 Rental Income",
        "Rentals:The Clubhouse",
        0,
        3000,
      ],
      [
        4,
        new Date(Date.UTC(2024, 0, 1)),
        "Sabastro Consulting",
        "Rent",
        "3102 Capital Distribution",
        "Rentals:The Clubhouse",
        3000,
        0,
      ],
      [
        4,
        new Date(Date.UTC(2024, 0, 2)),
        "Zoom",
        "ZOOM.US",
        "5214 Software Expense",
        "General",
        16.95,
        0,
      ],
      [
        4,
        new Date(Date.UTC(2024, 0, 2)),
        "Zoom",
        "ZOOM.US",
        "1101 Bank of America Checking Account",
        "General",
        0,
        16.95,
      ],
    ];
    rows.forEach((r, i) => r.forEach((v, j) => (ws.getCell(3 + i, 2 + j).value = v)));
    // A credit written as a formula with a cached result, like the workbook's "=H3" cells.
    ws.getCell("I3").value = { formula: "H4", result: 100 };
    const file = path.join(dir, "a.xlsx");
    await wb.xlsx.writeFile(file);

    const x = await extractWorkbookA(file);
    expect(x.lines).toHaveLength(9);
    expect(x.entries.map((e) => e.txn)).toEqual([1, 2, 3, 4]);
    expect(x.lines[0]).toMatchObject({
      row: 3,
      accountNumber: "1101",
      creditCents: 10000n,
      name: "Lowes",
      memo: "LOWES #02405",
      date: "2020-03-05",
    });
    expect(x.entries[0]).toMatchObject({ kind: "BANK", primaryBank: "1101", vendor: "Lowes" });
    expect(x.lines[2]).toMatchObject({
      rawDebit: -3,
      debitCents: 0n,
      creditCents: 300n,
      normalised: true,
    });
    expect(x.entries[1]).toMatchObject({ kind: "ADJUSTING", imbalanceCents: 0n });
    expect(x.entries[2]).toMatchObject({
      isVoidPlaceholder: true,
      vendor: "Bank of America",
      kind: "JOURNAL",
    });
    expect(x.entries[3]).toMatchObject({
      isMerged: true,
      vendor: "Zoom",
      date: "2024-01-02",
      mixedDates: true,
    });
  });

  it("reads a 2025 snapshot sheet: the split placeholder, Venmo, the unsplit note, Jose's rows, receipts, the trailer", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Transactions");
    [
      "#",
      "Date",
      "Amount",
      "Vendor",
      "Status",
      "Readiness",
      "Checked?",
      "Account",
      "Class",
      "Bank account",
      "Full bank description",
      "Ledger note",
      "My notes / answer",
      "Row ID",
      "Receipts",
      "Filled in by",
    ].forEach((h, i) => (ws.getCell(1, 1 + i).value = h));
    const rows: (string | number | Date | null)[][] = [
      [
        1,
        new Date(Date.UTC(2025, 0, 3)),
        -28.59,
        "Amazon",
        "Confirmed",
        "Ready",
        "Not checked",
        "5215 Supplies Expense",
        "General",
        "Real Estate (1101)",
        "AMAZON MKTPL*X 01/03",
        "(3x) USB C cords",
        " ",
        "3cea50d6",
        null,
        "2025 worksheet",
      ],
      [
        2,
        new Date(Date.UTC(2025, 0, 6)),
        2450,
        "Heather Blansfield",
        "Confirmed",
        "Ready",
        "Not checked",
        "4101 Rental Income",
        "Rentals:544 Liberty Circle",
        "Real Estate (1101)",
        "Apartments.com",
        null,
        "my note",
        "12bdbb14",
        2,
        "Jose's worksheet",
      ],
      [
        3,
        new Date(Date.UTC(2025, 8, 18)),
        -7804.25,
        "Eureka Ergonomic",
        "Confirmed",
        "Ready",
        "Not checked",
        "(split - varies)",
        "Providence",
        "PLA (1103)",
        "SP EUREKA",
        "office desks/chairs",
        " ",
        "e295d629",
        null,
        null,
      ],
      [
        4,
        new Date(Date.UTC(2025, 11, 15)),
        -225,
        "Raul Snow Plower",
        "Confirmed",
        "Ready",
        "Not checked",
        "5208 Snow Removal Expense",
        "Providence",
        "Venmo",
        null,
        "snow removal",
        null,
        null,
        null,
        null,
      ],
      [
        5,
        new Date(Date.UTC(2025, 2, 1)),
        -50,
        "Sunoco",
        "Confirmed",
        "Ready",
        "Not checked",
        "5216 Travel Expense",
        "General",
        "Real Estate (1101)",
        "SUNOCO",
        " [Unsplit 2026-09-10: reverted from the value-based property split",
        null,
        "aa11bb22",
        1,
        "Sweep 2026-09-10, pattern default",
      ],
    ];
    rows.forEach((r, i) => r.forEach((v, j) => (ws.getCell(2 + i, 1 + j).value = v)));
    ws.getCell("E8").value = "Confirmed";
    ws.getCell("F8").value = 797; // the trailer rows below the table have no "#"
    const file = path.join(dir, "b.xlsx");
    await wb.xlsx.writeFile(file);

    const x = await extractWorkbookB(file);
    expect(x.rows).toHaveLength(5);
    expect(x.stoppedAtRow).toBe(7);
    expect(x.rows[0]).toMatchObject({
      ref: 1,
      date: "2025-01-03",
      amountCents: -2859n,
      accountNumber: "5215",
      bankNumber: "1101",
      ledgerNote: "(3x) USB C cords",
      userNote: null,
      receipts: 0,
      verifiedByOwner: false,
    });
    expect(x.rows[1]).toMatchObject({
      amountCents: 245000n,
      userNote: "my note",
      receipts: 2,
      verifiedByOwner: true,
      filledInBy: "Jose's worksheet",
      rowId: "12bdbb14",
    });
    expect(x.rows[2]).toMatchObject({
      isSplitPlaceholder: true,
      accountNumber: null,
      bankNumber: "1103",
    });
    expect(x.rows[3]).toMatchObject({ bankNumber: "1104", rowId: null, bankDescription: null });
    expect(x.rows[4]).toMatchObject({
      needsModelSplit: true,
      ledgerNote: "[Unsplit 2026-09-10: reverted from the value-based property split",
    });
  });
});

describe("reference model shares", () => {
  it("turns fractions into basis points that total 10,000, remainder to the largest share", () => {
    const r = sharesToBasisPoints([0.333333, 0.333333, 0.333334]);
    expect(r.bp.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(r.remainderIndex).toBe(2);
    expect(r.bp).toEqual([3333, 3333, 3334]);
    // Each share is rounded to the nearest basis point (the 2024 "% (all)" land share is 32.1135 %, not 32.17 %).
    const r2 = sharesToBasisPoints([
      0.05985, 0.0513, 0.085499, 0.321135, 0.222298, 0.064979, 0.064979, 0.064979, 0.064979,
    ]);
    // The nine rounded shares add up to 10,001, so the largest target absorbs the −1 and lands on 3210.
    expect(r2.bp[3]).toBe(3210);
    r2.bp.forEach((bp, i) =>
      expect(
        Math.abs(
          bp -
            (r2.bp.length &&
              [
                0.05985, 0.0513, 0.085499, 0.321135, 0.222298, 0.064979, 0.064979, 0.064979,
                0.064979,
              ][i]! * 10_000),
        ),
      ).toBeLessThanOrEqual(1.5),
    );
    expect(r2.bp.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(() => sharesToBasisPoints([0.5, 0.4])).toThrow(/total/);
  });

  it("checks that shares follow the weights", () => {
    const ok = checkPercentageSet({
      key: "v",
      label: "value",
      basis: "VALUE",
      description: "",
      cellRange: "",
      targets: [
        { label: "a", target: "Rentals:The Shed", weight: 300, share: 0.3 },
        { label: "b", target: "PERSONAL", weight: 700, share: 0.7 },
      ],
      usedFor: [],
    });
    expect(ok).toEqual([]);
    const bad = checkPercentageSet({
      key: "v",
      label: "value",
      basis: "VALUE",
      description: "",
      cellRange: "",
      targets: [
        { label: "a", target: "Rentals:The Shed", weight: 300, share: 0.43 },
        { label: "b", target: "PERSONAL", weight: 700, share: 0.57 },
      ],
      usedFor: [],
    });
    expect(bad.length).toBe(2);
  });
});

describe("loader against the database", () => {
  const FILE_A = `test-${Date.now()}-A.xlsx`;
  const FILE_B = `test-${Date.now()}-B.xlsx`;

  it("writes a 2019–2024 entry as-is under the lock override, a voided placeholder, and a bridged 2025 row", async () => {
    const lk = await buildLookups(db);
    const now = new Date();
    const entry = groupEntries([
      line({
        txn: 7,
        row: 20,
        accountNumber: "1101",
        className: "Rentals:The Shed",
        rawCredit: 100,
        name: "Lowes",
        memo: "LOWES #02405",
      }),
      line({
        txn: 7,
        row: 21,
        accountNumber: "5206",
        className: "Rentals:The Shed",
        rawDebit: 100,
        name: "Lowes",
      }),
      line({
        txn: 8,
        row: 22,
        accountNumber: "5212",
        className: "General",
        rawDebit: 0,
        name: "Bank of America",
        date: "2024-07-12",
      }),
      line({
        txn: 9,
        row: 23,
        accountNumber: "5204",
        className: "General",
        rawDebit: -3,
        date: "2023-12-31",
      }),
      line({
        txn: 9,
        row: 24,
        accountNumber: "5204",
        className: "Flips:1 Mystery Rose",
        rawDebit: 3,
        date: "2023-12-31",
      }),
    ]);
    const prepared = entry.map((e) => ({
      ...prepareEntryA(e, lk, actor, now),
      header: { ...prepareEntryA(e, lk, actor, now).header },
    }));
    // Re-prepare with a test source file so the real import is not confused.
    const ps = entry.map((e) => {
      const p = prepareEntryA(e, lk, actor, now);
      p.header.sourceFile = FILE_A;
      return p;
    });
    expect(prepared).toHaveLength(3);
    const rows = [
      rowB({
        ref: 100,
        className: "Providence",
        accountRaw: "5214 Software Expense",
        accountNumber: "5214",
        amountCents: -2500n,
        filledInBy: "Jose's worksheet",
        verifiedByOwner: true,
        receipts: 2,
        rowId: "abcd1234",
        ledgerNote: "[Unsplit 2026-09-10: test",
        needsModelSplit: true,
        userNote: "my note",
      }),
      rowB({
        ref: 101,
        isSplitPlaceholder: true,
        accountRaw: "(split - varies)",
        accountNumber: null,
        className: "Providence",
        bankNumber: "1103",
        bankRaw: "PLA (1103)",
        amountCents: -780425n,
      }),
      rowB({
        ref: 102,
        accountRaw: "5226 Wages Expense",
        accountNumber: "5226",
        className: "Maintenance Business",
        amountCents: -50000n,
      }),
    ];
    const pb = rows.map((r) => {
      const p = prepareRowB(r, lk, actor, now, { duplicatesOf: r.ref === 102 ? [103] : [] });
      p.header.sourceFile = FILE_B;
      return p;
    });

    // Without the override, a posted row in a FILED year is refused by the database.
    await expect(
      db.$transaction(async (tx) => {
        await insertPrepared(tx, [ps[0] as (typeof ps)[number]]);
      }),
    ).rejects.toThrow(/LOCKED_YEAR/);

    await db.$transaction(async (tx) => {
      await setLockOverride(tx, LOCK_OVERRIDE_REASON);
      await insertPrepared(tx, ps);
      await insertPrepared(tx, pb);
    });

    const a7 = await db.transaction.findFirstOrThrow({
      where: { sourceFile: FILE_A, sourceRef: "7" },
    });
    const t7 = await loadTransaction(db, a7.id);
    expect(t7).toMatchObject({
      status: "POSTED",
      kind: "BANK",
      source: "IMPORT",
      verifiedByOwner: true,
      vendor: "Lowes",
      memo: "LOWES #02405",
    });
    const live7 = liveLines(t7);
    expect(live7).toHaveLength(2); // exactly the workbook's lines, nothing derived
    expect(live7.map((l) => l.sourceRow).sort()).toEqual([20, 21]);
    expect(live7.every((l) => l.entityId === lk.entityByCode.get("SREI"))).toBe(true);

    const a8 = await db.transaction.findFirstOrThrow({
      where: { sourceFile: FILE_A, sourceRef: "8" },
    });
    expect(a8).toMatchObject({
      status: "VOIDED",
      voidReason: ZERO_PLACEHOLDER_REASON,
      vendor: "Bank of America",
    });
    expect(liveLines(await loadTransaction(db, a8.id))).toHaveLength(0);

    const a9 = await db.transaction.findFirstOrThrow({
      where: { sourceFile: FILE_A, sourceRef: "9" },
    });
    const t9 = await loadTransaction(db, a9.id);
    expect(t9.kind).toBe("ADJUSTING");
    const l9 = liveLines(t9);
    expect(l9.find((l) => l.sourceRow === 23)).toMatchObject({ debitCents: 0n, creditCents: 300n });
    expect(l9.find((l) => l.sourceRow === 24)).toMatchObject({ debitCents: 300n, creditCents: 0n });
    const notes9 = await db.note.findMany({ where: { transactionId: a9.id } });
    expect(notes9.some((n) => /negative|stored as a credit/i.test(n.body))).toBe(true);

    const b100 = await db.transaction.findFirstOrThrow({
      where: { sourceFile: FILE_B, sourceRef: "100" },
    });
    const t100 = await loadTransaction(db, b100.id);
    expect(t100).toMatchObject({
      status: "POSTED",
      needsModelSplit: true,
      verifiedByOwner: true,
      receiptExpectedCount: 2,
      sourceRef2: "abcd1234",
      filledInBy: "Jose's worksheet",
    });
    const l100 = liveLines(t100);
    expect(l100.filter((l) => l.isBridge)).toHaveLength(2);
    const pla = lk.entityByCode.get("PLA");
    const srei = lk.entityByCode.get("SREI");
    const net = (entity: string | undefined) =>
      l100
        .filter((l) => l.entityId === entity)
        .reduce((t, l) => t + l.debitCents - l.creditCents, 0n);
    expect(net(pla)).toBe(0n);
    expect(net(srei)).toBe(0n);
    const notes100 = await db.note.findMany({ where: { transactionId: b100.id } });
    expect(notes100.find((n) => n.kind === "USER")?.body).toBe("my note");
    expect(notes100.some((n) => n.kind === "SYSTEM" && n.body.startsWith("[Unsplit"))).toBe(true);
    expect(notes100.some((n) => /Cross-entity/.test(n.body))).toBe(true);

    const b101 = await db.transaction.findFirstOrThrow({
      where: { sourceFile: FILE_B, sourceRef: "101" },
    });
    expect(b101.status).toBe("FLAGGED");
    expect(b101.postedAt).toBeNull();
    expect((b101.flags as { code: string }[])[0]?.code).toBe("capitalize_vs_expense");
    const l101 = liveLines(await loadTransaction(db, b101.id));
    expect(
      l101.find((l) => !l.isBridge && l.accountId !== lk.bankByNumber.get("1103")?.accountId)
        ?.accountId,
    ).toBe(lk.accountByNumber.get("1313"));

    const b102 = await db.transaction.findFirstOrThrow({
      where: { sourceFile: FILE_B, sourceRef: "102" },
    });
    const notes102 = await db.note.findMany({ where: { transactionId: b102.id } });
    expect(notes102.some((n) => /net pay/.test(n.body))).toBe(true);
    expect(notes102.some((n) => /#103/.test(n.body))).toBe(true);

    // Idempotency key: the same source rows are reported as existing and the unique index refuses a repeat.
    expect(await existingSourceRefs(db, FILE_A)).toEqual(new Set(["7", "8", "9"]));
    await expect(
      db.$transaction(async (tx) => {
        await setLockOverride(tx, LOCK_OVERRIDE_REASON);
        await insertPrepared(tx, [ps[0] as (typeof ps)[number]]);
      }),
    ).rejects.toThrow();
  });

  it("stops with a clear message when an account or class is unknown", async () => {
    const lk = await buildLookups(db);
    const bad = groupEntries([
      line({ txn: 50, row: 60, accountNumber: "1101", className: "General", rawCredit: 1 }),
      line({ txn: 50, row: 61, accountNumber: "9999", className: "General", rawDebit: 1 }),
    ]);
    expect(() => prepareEntryA(bad[0] as (typeof bad)[number], lk, actor, new Date())).toThrow(
      /account 9999 is not in the chart/,
    );
    expect(() =>
      prepareRowB(rowB({ ref: 1, className: "Rentals:Nowhere" }), lk, actor, new Date(), {
        duplicatesOf: [],
      }),
    ).toThrow(/class "Rentals:Nowhere" is not in the seed/);
  });

  it("keeps allocation model versions and targets immutable and their shares whole", async () => {
    const srei = (await owner.entity.findUniqueOrThrow({ where: { code: "SREI" } })).id;
    const ty = await owner.taxYear.findUniqueOrThrow({
      where: { entityId_year: { entityId: srei, year: 2024 } },
    });
    const shed = await owner.class.findUniqueOrThrow({ where: { name: "Rentals:The Shed" } });
    const model = await db.allocationModel.create({
      data: {
        entityId: srei,
        taxYearId: ty.id,
        name: `test model ${Date.now()}`,
        isReference: true,
      },
    });
    await expect(
      db.$transaction(async (tx) => {
        const v = await tx.allocationModelVersion.create({
          data: { modelId: model.id, versionNo: 1, basis: "VALUE" },
        });
        await tx.allocationTarget.createMany({
          data: [
            {
              versionId: v.id,
              classId: shed.id,
              label: "Shed",
              weight: "1",
              shareBp: 6000,
              isRemainderTarget: true,
              sortOrder: 0,
            },
            {
              versionId: v.id,
              classId: null,
              isPersonal: true,
              label: "House",
              weight: "1",
              shareBp: 3000,
              sortOrder: 1,
            },
          ],
        });
      }),
    ).rejects.toThrow(/10,000/);
    const version = await db.$transaction(async (tx) => {
      const v = await tx.allocationModelVersion.create({
        data: { modelId: model.id, versionNo: 1, basis: "VALUE" },
      });
      await tx.allocationTarget.createMany({
        data: [
          {
            versionId: v.id,
            classId: shed.id,
            label: "Shed",
            weight: "1",
            shareBp: 6000,
            isRemainderTarget: true,
            sortOrder: 0,
          },
          {
            versionId: v.id,
            classId: null,
            isPersonal: true,
            label: "House",
            weight: "1",
            shareBp: 4000,
            sortOrder: 1,
          },
        ],
      });
      return v;
    });
    await expect(
      db.allocationModelVersion.update({ where: { id: version.id }, data: { note: "changed" } }),
    ).rejects.toThrow(/immutable|permission denied/); // the app role has no UPDATE grant; the trigger backs it up
    await expect(
      owner.allocationTarget.deleteMany({ where: { versionId: version.id } }),
    ).rejects.toThrow(/immutable/);
  });
});

const sourceDir = path.join(process.cwd(), "data", "source");
const haveWorkbooks = sourcePaths(sourceDir).every((p) => existsSync(p.path));

describe.skipIf(!haveWorkbooks)(
  "the real import (private workbooks present on this machine)",
  () => {
    it(
      "imports both workbooks, passes every acceptance check, and is a no-op the second time",
      async () => {
        const first = await runImport(db, {
          sourceDir,
          dryRun: false,
          actor,
          trigger: "cli",
          reportPath: null,
        });
        const failures = [
          ...first.summary.checks.preA,
          ...first.summary.checks.preB,
          ...first.summary.checks.models,
          ...first.summary.checks.db,
        ].filter((c) => !c.ok && c.critical);
        expect(failures.map((c) => `${c.label}: ${c.expected} vs ${c.actual}`)).toEqual([]);
        expect(first.status).toBe("SUCCEEDED");
        expect(first.allChecksPassed).toBe(true);
        // Holds on a fresh database (everything inserted) and on a persistent one (everything already there).
        expect(first.summary.load.a.inserted + first.summary.load.a.existing).toBe(2999);
        expect(first.summary.load.b.inserted + first.summary.load.b.existing).toBe(833);
        expect(
          first.summary.load.models.inserted + first.summary.load.models.existing,
        ).toBeGreaterThanOrEqual(5);

        const second = await runImport(db, {
          sourceDir,
          dryRun: false,
          actor,
          trigger: "cli",
          reportPath: null,
        });
        expect(second.status).toBe("SUCCEEDED");
        expect(second.summary.load).toMatchObject({
          a: { inserted: 0, existing: 2999 },
          b: { inserted: 0, existing: 833 },
          models: { inserted: 0 },
        });
        expect(second.allChecksPassed).toBe(true);

        const counts = await db.transaction.groupBy({
          by: ["sourceFile", "status"],
          where: { source: "IMPORT", sourceFile: { in: [SOURCE_A, SOURCE_B] } },
          _count: { _all: true },
        });
        const n = (f: string, s: string) =>
          counts.find((c) => c.sourceFile === f && c.status === s)?._count._all ?? 0;
        expect(n(SOURCE_A, "POSTED")).toBe(2995);
        expect(n(SOURCE_A, "VOIDED")).toBe(4);
        expect(n(SOURCE_B, "POSTED")).toBe(832);
        expect(n(SOURCE_B, "FLAGGED")).toBe(1);
        const years = await db.taxYear.findMany({ include: { entity: true } });
        expect(
          years
            .filter((y) => y.entity.code === "SREI" && y.year <= 2024)
            .every((y) => y.state === "FILED"),
        ).toBe(true);
        expect(years.find((y) => y.entity.code === "SREI" && y.year === 2025)?.state).toBe("OPEN");
        expect(years.find((y) => y.entity.code === "PLA" && y.year === 2025)?.state).toBe("OPEN");
      },
      15 * 60_000,
    );
  },
);
