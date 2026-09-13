import { loadSeedAccounts, loadSeedClasses, type SeedAccount } from "@/lib/seed/seed-data";
import { BANK_BY_LABEL } from "./workbook-b";
import {
  centsFromDecimalString,
  cents,
  type BankNumber,
  type Check,
  type RowB,
  type WorkbookAExtract,
  type WorkbookBExtract,
} from "./types";

/**
 * The acceptance checklist of DATA_SOURCES.md / docs/WORKBOOK_VERIFICATION.md, as code. Every number
 * those documents verified in Phase 0 is reproduced here from the extraction (before anything is
 * written) and again from the database after the load. A critical check that fails stops the import.
 */

const $ = centsFromDecimalString;

// ---------------------------------------------------------------------------
// Targets (from docs/WORKBOOK_VERIFICATION.md, which wins over DATA_SOURCES.md where they differ)
// ---------------------------------------------------------------------------

export const TARGET_A = {
  lineCount: 7144,
  linesWithAmounts: 7140,
  entryCount: 2999,
  firstDate: "2019-04-01",
  lastDate: "2024-12-31",
  linesPerYear: { 2019: 186, 2020: 1438, 2021: 1037, 2022: 1403, 2023: 1431, 2024: 1649 } as Record<
    number,
    number
  >,
  signedTotal: $("13,291,914.04"),
  normalisedTotal: $("13,303,638.68"),
  /** 43 lines carry a negative amount: 25 negative debits and 18 negative credits (WORKBOOK_VERIFICATION
   *  lumped them as "43 negative debits"). Each side sums to −5,862.32 after per-line cent rounding
   *  (−5,862.33 in exact decimals), so the gross totals rise by 11,724.64 in all (P0-1). */
  negativeAmountLines: 43,
  negativeDebitLines: 25,
  negativeCreditLines: 18,
  negativeDebitSum: $("−5,862.32"),
  negativeCreditSum: $("−5,862.32"),
  /**
   * Twelve 2024 workbook numbers cover two bookings: the monthly Clubhouse rent (income against a
   * distribution, no cash) followed by an unrelated bank item. Kept together; header from the bank item.
   */
  mergedEntries: [2264, 2327, 2374, 2428, 2480, 2531, 2598, 2658, 2724, 2779, 2831, 2898],
  /** Four of the merged entries carry two dates (the rent on the 1st, the bank item a day or two later). */
  mixedDateEntries: [2264, 2531, 2724, 2898],
  /** A payment and its reversal on 1101, net 0.00: stored as journal entries so both lines show. */
  selfCancellingEntries: [353, 504, 571, 928, 942, 947, 1034],
  /** Amounts with fractions of a cent, all inside the 2023 year-end reallocation entries 2236–2243. */
  subCentAmounts: 194,
  /** Formula cells exceljs reports without a cached value (openpyxl reads them as 0); all are zero amounts. */
  formulaCellsWithoutCachedResult: 144,
  zeroAmountEntries: [2623, 2624, 2625, 2626],
  accountsUsed: 67,
  bank1101At2024: $("523.80"),
  bank1102At2019: $("0.00"),
  cumulativeByType2024: {
    ASSET: $("2,183,960.10"),
    LIABILITY: $("−5,725.00"),
    EQUITY_INCL_INCOME_EXPENSE: $("−2,178,235.10"),
  },
  classYears: {
    General: "2019–2024",
    "Rentals:142 Maloney Terrace": "2019–2024",
    "Rentals:The Clubhouse": "2020–2024",
    "Rentals:The Shed": "2020–2024",
    "Land Development:13 Chisel Creek Dr": "2020–2024",
    "Flips:1 Mystery Rose": "2020",
    "Rentals:176 Tulsk Road": "2021–2024",
    "Rentals:544 Liberty Circle": "2021–2024",
    "Rentals:533 Mystic Lane": "2022–2024",
    "Land Development:1671-1675 New London Rd": "2023–2024",
    "Rentals:136 Sunnyside": "2024",
  } as Record<string, string>,
};

export const SUB_TYPES = [
  "Bank",
  "Fixed Asset",
  "Other Current Assets",
  "Other Current Liabilities",
  "Equity",
  "Income",
  "Expense",
] as const;
export type SubType = (typeof SUB_TYPES)[number];

export const CLASSES_A = [
  "Flips:1 Mystery Rose",
  "General",
  "Land Development:13 Chisel Creek Dr",
  "Land Development:1671-1675 New London Rd",
  "Rentals:136 Sunnyside",
  "Rentals:142 Maloney Terrace",
  "Rentals:176 Tulsk Road",
  "Rentals:533 Mystic Lane",
  "Rentals:544 Liberty Circle",
  "Rentals:The Clubhouse",
  "Rentals:The Shed",
] as const;

type Table = Record<string, Partial<Record<SubType, bigint>>>;

function table(rows: Record<string, Partial<Record<SubType, string>>>): Table {
  const out: Table = {};
  for (const [cls, cols] of Object.entries(rows)) {
    out[cls] = {};
    for (const st of SUB_TYPES) (out[cls] as Record<string, bigint>)[st] = $(cols[st] ?? "0.00");
  }
  return out;
}

/** 2019–2024, all six years, debit-positive (Bank · Fixed Asset · Other Current Liabilities · Equity · Income · Expense). */
export const CLASS_SUBTYPE_FULL: Table = table({
  "Flips:1 Mystery Rose": { Equity: "27,948.88", Income: "−115,697.93", Expense: "87,749.05" },
  General: {},
  "Land Development:13 Chisel Creek Dr": {
    Bank: "323.80",
    "Fixed Asset": "359,297.50",
    Equity: "−680,500.42",
    Income: "−12,534.78",
    Expense: "333,413.90",
  },
  "Land Development:1671-1675 New London Rd": {
    "Fixed Asset": "354,765.00",
    Equity: "−408,151.81",
    Income: "−400.00",
    Expense: "53,786.81",
  },
  "Rentals:136 Sunnyside": {
    "Fixed Asset": "338,577.80",
    Equity: "−420,703.13",
    Expense: "82,125.33",
  },
  "Rentals:142 Maloney Terrace": {
    "Fixed Asset": "195,940.00",
    "Other Current Liabilities": "−1,625.00",
    Equity: "−203,603.05",
    Income: "−120,300.20",
    Expense: "129,588.25",
  },
  "Rentals:176 Tulsk Road": {
    Bank: "100.00",
    "Fixed Asset": "220,007.00",
    "Other Current Liabilities": "−1,975.00",
    Equity: "−239,942.25",
    Income: "−86,787.00",
    Expense: "108,597.25",
  },
  "Rentals:533 Mystic Lane": { Equity: "6,833.69", Income: "−29,862.86", Expense: "23,029.17" },
  "Rentals:544 Liberty Circle": {
    Bank: "100.00",
    "Fixed Asset": "219,235.00",
    "Other Current Liabilities": "−2,125.00",
    Equity: "−232,179.92",
    Income: "−97,825.00",
    Expense: "112,794.92",
  },
  "Rentals:The Clubhouse": {
    "Fixed Asset": "292,472.00",
    Equity: "−418,844.48",
    Income: "−93,800.00",
    Expense: "220,172.48",
  },
  "Rentals:The Shed": {
    "Fixed Asset": "203,142.00",
    Equity: "−294,831.56",
    Income: "−17,403.22",
    Expense: "109,092.78",
  },
  TOTAL: {
    Bank: "523.80",
    "Fixed Asset": "2,183,436.30",
    "Other Current Liabilities": "−5,725.00",
    Equity: "−2,863,974.05",
    Income: "−574,610.99",
    Expense: "1,260,349.94",
  },
});

/** Workbook A's Region 3 pivot: its cached values cover 2024 only (WORKBOOK_VERIFICATION discrepancy 2). */
export const CLASS_SUBTYPE_2024: Table = table({
  "Flips:1 Mystery Rose": {},
  General: { Bank: "−35,664.89", Equity: "35,664.89" },
  "Land Development:13 Chisel Creek Dr": {
    Bank: "16,576.80",
    "Fixed Asset": "9,039.50",
    Equity: "−103,112.14",
    Income: "−12,534.78",
    Expense: "90,030.62",
  },
  "Land Development:1671-1675 New London Rd": {
    Bank: "24,212.17",
    Equity: "−39,351.08",
    Income: "−400.00",
    Expense: "15,538.91",
  },
  "Rentals:136 Sunnyside": {
    "Fixed Asset": "338,577.80",
    Equity: "−420,703.13",
    Expense: "82,125.33",
  },
  "Rentals:142 Maloney Terrace": {
    Bank: "−15,171.30",
    "Fixed Asset": "−5,836.00",
    "Other Current Liabilities": "400.00",
    Equity: "26,930.33",
    Income: "−21,875.20",
    Expense: "15,552.17",
  },
  "Rentals:176 Tulsk Road": {
    Bank: "−99.83",
    "Fixed Asset": "−7,151.00",
    Equity: "15,137.48",
    Income: "−24,975.00",
    Expense: "17,088.35",
  },
  "Rentals:533 Mystic Lane": { Bank: "977.76", Equity: "−977.76" },
  "Rentals:544 Liberty Circle": {
    Bank: "−99.50",
    "Fixed Asset": "−7,126.00",
    Equity: "17,373.51",
    Income: "−28,400.00",
    Expense: "18,251.99",
  },
  "Rentals:The Clubhouse": {
    Bank: "2,528.16",
    "Fixed Asset": "−5,952.00",
    Equity: "−801.36",
    Income: "−36,000.00",
    Expense: "40,225.20",
  },
  "Rentals:The Shed": {
    Bank: "5,130.36",
    "Fixed Asset": "−3,645.00",
    Equity: "−20,866.84",
    Income: "−3,360.00",
    Expense: "22,741.48",
  },
  TOTAL: {
    Bank: "−1,610.27",
    "Fixed Asset": "317,907.30",
    "Other Current Liabilities": "400.00",
    Equity: "−490,706.10",
    Income: "−127,544.98",
    Expense: "301,554.05",
  },
});

export const TARGET_B = {
  rowCount: 833,
  refMin: 1,
  refMax: 850,
  amountSum: $("10,891.95"),
  amountIn: $("310,679.28"),
  amountOut: $("−299,787.33"),
  byBank: { "1101": 623, "1103": 172, "1104": 38 } as Record<BankNumber, number>,
  byClass: {
    Providence: 255,
    General: 191,
    "Rentals:176 Tulsk Road": 85,
    "Rentals:The Shed": 74,
    "Rentals:136 Sunnyside": 60,
    "Rentals:142 Maloney Terrace": 57,
    "Rentals:544 Liberty Circle": 46,
    "Maintenance Business": 33,
    "Rentals:The Clubhouse": 16,
    "Land Development:13 Chisel Creek Dr": 14,
    "Land Development:1671-1675 New London Rd": 2,
  } as Record<string, number>,
  distinctAccounts: 29,
  splitRows: [464],
  splitRowAmount: $("−7,804.25"),
  unsplitRows: 93,
  unsplitNet: $("−35,662.95"),
  unsplitByClass: {
    General: 67,
    Providence: 13,
    "Rentals:136 Sunnyside": 12,
    "Maintenance Business": 1,
  } as Record<string, number>,
  providenceOn1101: 89,
  providenceOn1101Net: $("−9,955.79"),
  providenceOn1101BeforeLaunch: 21,
  plaLaunchPlaceholder: "2025-06-02",
  generalOn1103: 9,
  generalOn1103ByAccount: { "3102": 8, "5215": 1 } as Record<string, number>,
  joseRows: 357,
  blankFilledInBy: 166,
  distinctFilledInBy: 31,
  receiptRows: 121,
  receiptFiles: 129,
  receiptDistribution: { 1: 115, 2: 4, 3: 2 } as Record<number, number>,
  /** WORKBOOK_VERIFICATION counted 798 distinct Row IDs and 32 "Filled in by" values; both counts included the blank value. */
  distinctRowIds: 797,
  blankRowIds: 36,
  userNoteRows: 75,
  ledgerNoteRows: 454,
  positiveExpenseRows: 25,
  sameDayGroups: 7,
  sameDayRows: 15,
  mcGovernRefs: [10, 11, 12],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface SeedChart {
  byNumber: Map<string, SeedAccount>;
  classNames: Set<string>;
}

export function loadSeedChart(): SeedChart {
  return {
    byNumber: new Map(loadSeedAccounts().map((a) => [a.number, a])),
    classNames: new Set(loadSeedClasses().map((c) => c.name)),
  };
}

function check(
  group: string,
  label: string,
  expected: string | number | bigint,
  actual: string | number | bigint,
  opts: { critical?: boolean; note?: string } = {},
): Check {
  const fmt = (v: string | number | bigint) =>
    typeof v === "bigint" ? cents(v) : typeof v === "number" ? v.toLocaleString("en-US") : v;
  return {
    group,
    label,
    expected: fmt(expected),
    actual: fmt(actual),
    ok: fmt(expected) === fmt(actual),
    critical: opts.critical ?? true,
    note: opts.note,
  };
}

function sum(values: Iterable<bigint>): bigint {
  let t = 0n;
  for (const v of values) t += v;
  return t;
}

export function yearOfDate(date: string): number {
  return Number(date.slice(0, 4));
}

/** Debit-minus-credit per class × seed sub-type over the given lines. */
export function classSubTypeTotals(
  lines: Iterable<{
    className: string;
    accountNumber: string;
    debitCents: bigint;
    creditCents: bigint;
  }>,
  chart: SeedChart,
): Table {
  const out: Table = {};
  const add = (cls: string, st: SubType, v: bigint) => {
    const row = (out[cls] ??= {});
    row[st] = (row[st] ?? 0n) + v;
  };
  for (const l of lines) {
    const acct = chart.byNumber.get(l.accountNumber);
    if (!acct) continue;
    const st = acct.subType as SubType;
    const v = l.debitCents - l.creditCents;
    add(l.className, st, v);
    add("TOTAL", st, v);
  }
  return out;
}

function tableChecks(group: string, expected: Table, actual: Table): Check[] {
  const out: Check[] = [];
  for (const cls of [...CLASSES_A, "TOTAL"]) {
    for (const st of SUB_TYPES) {
      const e = expected[cls]?.[st] ?? 0n;
      const a = actual[cls]?.[st] ?? 0n;
      if (e === 0n && a === 0n && st === "Other Current Assets") continue;
      out.push(check(group, `${cls} · ${st}`, e, a));
    }
  }
  // Any class in the actual table that the target does not know about is a failure too.
  for (const cls of Object.keys(actual)) {
    if (!(cls in expected)) {
      const total = sum(Object.values(actual[cls] ?? {}));
      out.push(check(group, `${cls} (unexpected class)`, "absent", cents(total)));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Workbook A — checks on the extraction (before the load)
// ---------------------------------------------------------------------------

export function checksForWorkbookA(x: WorkbookAExtract, chart: SeedChart): Check[] {
  const G = "2019–2024 workbook";
  const out: Check[] = [];
  const { lines, entries } = x;

  out.push(check(G, "Journal lines read", TARGET_A.lineCount, lines.length));
  out.push(
    check(
      G,
      "Lines carrying an amount",
      TARGET_A.linesWithAmounts,
      lines.filter((l) => !l.isZero).length,
    ),
  );
  out.push(check(G, "Transactions (by cached Transaction #)", TARGET_A.entryCount, entries.length));
  const txns = entries.map((e) => e.txn);
  const contiguous = txns.every((t, i) => t === i + 1);
  out.push(check(G, "Transaction numbers run 1…N without gaps", "yes", contiguous ? "yes" : "no"));
  out.push(
    check(
      G,
      "First date",
      TARGET_A.firstDate,
      lines.reduce((m, l) => (l.date < m ? l.date : m), lines[0]?.date ?? ""),
    ),
  );
  out.push(
    check(
      G,
      "Last date",
      TARGET_A.lastDate,
      lines.reduce((m, l) => (l.date > m ? l.date : m), ""),
    ),
  );
  for (const [year, n] of Object.entries(TARGET_A.linesPerYear)) {
    out.push(
      check(
        G,
        `Lines dated ${year}`,
        n,
        lines.filter((l) => yearOfDate(l.date) === Number(year)).length,
      ),
    );
  }
  const signedDebit = sum(lines.map((l) => centsOf(l.rawDebit)));
  const signedCredit = sum(lines.map((l) => centsOf(l.rawCredit)));
  out.push(check(G, "Σ Debit as written (signed)", TARGET_A.signedTotal, signedDebit));
  out.push(check(G, "Σ Credit as written (signed)", TARGET_A.signedTotal, signedCredit));
  out.push(
    check(
      G,
      "Σ Debit after normalisation (P0-1)",
      TARGET_A.normalisedTotal,
      sum(lines.map((l) => l.debitCents)),
    ),
  );
  out.push(
    check(
      G,
      "Σ Credit after normalisation (P0-1)",
      TARGET_A.normalisedTotal,
      sum(lines.map((l) => l.creditCents)),
    ),
  );
  const negDebit = lines.filter((l) => l.rawDebit < 0);
  const negCredit = lines.filter((l) => l.rawCredit < 0);
  out.push(
    check(
      G,
      "Lines with a negative amount (P0-1)",
      TARGET_A.negativeAmountLines,
      negDebit.length + negCredit.length,
    ),
  );
  out.push(
    check(G, "…negative Debits (stored as credits)", TARGET_A.negativeDebitLines, negDebit.length),
  );
  out.push(
    check(
      G,
      "…Σ of the negative debits",
      TARGET_A.negativeDebitSum,
      sum(negDebit.map((l) => centsOf(l.rawDebit))),
    ),
  );
  out.push(
    check(
      G,
      "…negative Credits (stored as debits)",
      TARGET_A.negativeCreditLines,
      negCredit.length,
    ),
  );
  out.push(
    check(
      G,
      "…Σ of the negative credits",
      TARGET_A.negativeCreditSum,
      sum(negCredit.map((l) => centsOf(l.rawCredit))),
    ),
  );
  const zeroEntries = entries.filter((e) => e.isVoidPlaceholder).map((e) => e.txn);
  out.push(
    check(
      G,
      "Zero-amount entries → voided placeholders (P0-3)",
      TARGET_A.zeroAmountEntries.join(", "),
      zeroEntries.join(", "),
    ),
  );
  out.push(
    check(
      G,
      "Zero-amount lines inside other entries",
      0,
      lines.filter((l) => l.isZero).length - zeroEntries.length,
      { critical: false },
    ),
  );
  out.push(
    check(
      G,
      "Entries that do not balance",
      0,
      entries.filter((e) => e.imbalanceCents !== 0n).length,
    ),
  );
  out.push(
    check(
      G,
      "Workbook numbers that cover two bookings (kept together, header from the bank item)",
      TARGET_A.mergedEntries.join(", "),
      entries
        .filter((e) => e.isMerged)
        .map((e) => e.txn)
        .join(", "),
      { critical: false, note: "See “entries worth a glance” in the report and decision P2-3." },
    ),
  );
  out.push(
    check(
      G,
      "…of which carry two dates (dated on the bank item)",
      TARGET_A.mixedDateEntries.join(", "),
      entries
        .filter((e) => e.mixedDates)
        .map((e) => e.txn)
        .join(", "),
      { critical: false },
    ),
  );
  out.push(
    check(
      G,
      "Entries that are a payment and its reversal on one bank account (stored as journals)",
      TARGET_A.selfCancellingEntries.join(", "),
      entries
        .filter((e) => e.isSelfCancelling)
        .map((e) => e.txn)
        .join(", "),
      { critical: false },
    ),
  );
  const accounts = new Set(lines.map((l) => l.accountNumber));
  out.push(check(G, "Distinct accounts used", TARGET_A.accountsUsed, accounts.size));
  const unknownAccounts = [...accounts].filter((n) => !chart.byNumber.has(n));
  out.push(
    check(
      G,
      "Accounts missing from the seed chart",
      "none",
      unknownAccounts.length ? unknownAccounts.join(", ") : "none",
    ),
  );
  const classes = new Map<string, Set<number>>();
  for (const l of lines) {
    const s = classes.get(l.className) ?? new Set<number>();
    s.add(yearOfDate(l.date));
    classes.set(l.className, s);
  }
  const unknownClasses = [...classes.keys()].filter((c) => !chart.classNames.has(c));
  out.push(
    check(
      G,
      "Classes missing from the seed",
      "none",
      unknownClasses.length ? unknownClasses.join(", ") : "none",
    ),
  );
  for (const [cls, years] of Object.entries(TARGET_A.classYears)) {
    const ys = [...(classes.get(cls) ?? [])].sort();
    const span =
      ys.length === 0 ? "—" : ys.length === 1 ? String(ys[0]) : `${ys[0]}–${ys[ys.length - 1]}`;
    out.push(check(G, `Class ${cls} active years`, years, span, { critical: false }));
  }
  out.push(
    check(
      G,
      "Formula cells with no cached value (read as 0.00)",
      TARGET_A.formulaCellsWithoutCachedResult,
      x.formulaCellsWithoutCachedResult,
      {
        critical: false,
        note: "Cells like H7140 (=I7139) whose cached value Excel stored as empty; openpyxl reads them as 0 and every total ties, so they are zero.",
      },
    ),
  );
  out.push(
    check(
      G,
      "Amounts with fractions of a cent (rounded per line)",
      TARGET_A.subCentAmounts,
      x.subCentAmounts.length,
      {
        critical: false,
        note: "All in the 2023 year-end reallocation entries 2236–2243; every entry still balances to the cent after rounding.",
      },
    ),
  );

  // Class × sub-type tables.
  const money = lines.filter((l) => !l.isZero);
  out.push(
    ...tableChecks(
      "2019–2024 class × sub-type (all years)",
      CLASS_SUBTYPE_FULL,
      classSubTypeTotals(money, chart),
    ),
  );
  out.push(
    ...tableChecks(
      "2024 class × sub-type (workbook pivot)",
      CLASS_SUBTYPE_2024,
      classSubTypeTotals(
        money.filter((l) => yearOfDate(l.date) === 2024),
        chart,
      ),
    ),
  );

  // Bank balances and cumulative by type.
  const bal = (n: string, upTo: string) =>
    sum(
      money
        .filter((l) => l.accountNumber === n && l.date <= upTo)
        .map((l) => l.debitCents - l.creditCents),
    );
  out.push(
    check(G, "1101 balance at 2024-12-31", TARGET_A.bank1101At2024, bal("1101", "2024-12-31")),
  );
  out.push(
    check(G, "1102 balance at 2019-12-31", TARGET_A.bank1102At2019, bal("1102", "2019-12-31")),
  );
  out.push(
    check(
      G,
      "1102 used after 2019",
      "no",
      money.some((l) => l.accountNumber === "1102" && l.date > "2019-12-31") ? "yes" : "no",
    ),
  );
  out.push(
    check(
      G,
      "1103 / 1104 used in 2019–2024",
      "no",
      money.some((l) => l.accountNumber === "1103" || l.accountNumber === "1104") ? "yes" : "no",
    ),
  );
  const byType = { ASSET: 0n, LIABILITY: 0n, EQUITY_INCL_INCOME_EXPENSE: 0n };
  for (const l of money) {
    const t = chart.byNumber.get(l.accountNumber)?.type;
    const v = l.debitCents - l.creditCents;
    if (t === "ASSET") byType.ASSET += v;
    else if (t === "LIABILITY") byType.LIABILITY += v;
    else byType.EQUITY_INCL_INCOME_EXPENSE += v;
  }
  out.push(
    check(G, "Cumulative Asset at 2024-12-31", TARGET_A.cumulativeByType2024.ASSET, byType.ASSET),
  );
  out.push(
    check(
      G,
      "Cumulative Liability at 2024-12-31",
      TARGET_A.cumulativeByType2024.LIABILITY,
      byType.LIABILITY,
    ),
  );
  out.push(
    check(
      G,
      "Cumulative Equity (incl. income/expense) at 2024-12-31",
      TARGET_A.cumulativeByType2024.EQUITY_INCL_INCOME_EXPENSE,
      byType.EQUITY_INCL_INCOME_EXPENSE,
    ),
  );
  return out;
}

function centsOf(n: number): bigint {
  // Same rounding as the reader (half away from zero at two decimals).
  const sign = n < 0 ? -1n : 1n;
  const abs = Math.abs(n);
  return sign * BigInt(Math.round(abs * 100 + 1e-9));
}

// ---------------------------------------------------------------------------
// Workbook B — checks on the extraction (before the load)
// ---------------------------------------------------------------------------

export function isCrossEntityRow(r: RowB): boolean {
  const plaBank = r.bankNumber === "1103";
  const plaClass = r.className === "Providence";
  if (r.className === "General") return false;
  return plaBank !== plaClass;
}

/** Duplicate suspects the way CLAUDE.md defines them: same bank account, date and amount (Phase 0 counted 7 groups / 15 rows). */
export function sameDayGroups(rows: readonly RowB[]): RowB[][] {
  const groups = new Map<string, RowB[]>();
  for (const r of rows) {
    const key = [r.date, r.amountCents.toString(), r.bankNumber].join("|");
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

export function checksForWorkbookB(x: WorkbookBExtract, chart: SeedChart): Check[] {
  const G = "2025 snapshot";
  const out: Check[] = [];
  const { rows } = x;
  out.push(
    check(G, "Rows read (stops at the first non-integer #)", TARGET_B.rowCount, rows.length),
  );
  out.push(
    check(G, "Reader stopped at sheet row", "835", String(x.stoppedAtRow ?? "—"), {
      critical: false,
      note: "The two trailer rows (837–838) are below the table.",
    }),
  );
  const refs = rows.map((r) => r.ref);
  out.push(
    check(G, "Row references unique", "yes", new Set(refs).size === refs.length ? "yes" : "no"),
  );
  out.push(
    check(
      G,
      "Smallest / largest #",
      `${TARGET_B.refMin} / ${TARGET_B.refMax}`,
      `${Math.min(...refs)} / ${Math.max(...refs)}`,
    ),
  );
  out.push(
    check(
      G,
      "Dates inside 2025",
      "yes",
      rows.every((r) => r.date.startsWith("2025-")) ? "yes" : "no",
    ),
  );
  out.push(
    check(
      G,
      "Σ Amount (net cash movement)",
      TARGET_B.amountSum,
      sum(rows.map((r) => r.amountCents)),
    ),
  );
  out.push(
    check(
      G,
      "Money in",
      TARGET_B.amountIn,
      sum(rows.filter((r) => r.amountCents > 0n).map((r) => r.amountCents)),
    ),
  );
  out.push(
    check(
      G,
      "Money out",
      TARGET_B.amountOut,
      sum(rows.filter((r) => r.amountCents < 0n).map((r) => r.amountCents)),
    ),
  );
  for (const [bank, n] of Object.entries(TARGET_B.byBank)) {
    const label = Object.entries(BANK_BY_LABEL).find(([, v]) => v === bank)?.[0] ?? bank;
    out.push(check(G, `Rows on ${label}`, n, rows.filter((r) => r.bankNumber === bank).length));
  }
  for (const [cls, n] of Object.entries(TARGET_B.byClass)) {
    out.push(check(G, `Rows with class ${cls}`, n, rows.filter((r) => r.className === cls).length));
  }
  out.push(
    check(
      G,
      "Classes not in the target list",
      "none",
      [...new Set(rows.map((r) => r.className))]
        .filter((c) => !(c in TARGET_B.byClass))
        .join(", ") || "none",
    ),
  );
  out.push(
    check(
      G,
      "Distinct account strings (incl. the split placeholder)",
      TARGET_B.distinctAccounts,
      new Set(rows.map((r) => r.accountRaw)).size,
    ),
  );
  const unknownAccounts = [
    ...new Set(rows.map((r) => r.accountNumber).filter((n): n is string => !!n)),
  ].filter((n) => !chart.byNumber.has(n));
  out.push(
    check(G, "Accounts missing from the seed chart", "none", unknownAccounts.join(", ") || "none"),
  );
  const unknownClasses = [...new Set(rows.map((r) => r.className))].filter(
    (c) => !chart.classNames.has(c),
  );
  out.push(check(G, "Classes missing from the seed", "none", unknownClasses.join(", ") || "none"));
  const splits = rows.filter((r) => r.isSplitPlaceholder);
  out.push(
    check(
      G,
      "Rows still carrying a split (→ flagged draft)",
      TARGET_B.splitRows.join(", "),
      splits.map((r) => r.ref).join(", "),
    ),
  );
  out.push(
    check(G, "Split row amount", TARGET_B.splitRowAmount, sum(splits.map((r) => r.amountCents))),
  );
  const unsplit = rows.filter((r) => r.needsModelSplit);
  out.push(
    check(
      G,
      "Rows tagged needs_model_split (note starts “[Unsplit 2026-09-10”)",
      TARGET_B.unsplitRows,
      unsplit.length,
    ),
  );
  out.push(
    check(
      G,
      "Net of the unsplit rows",
      TARGET_B.unsplitNet,
      sum(unsplit.map((r) => r.amountCents)),
    ),
  );
  out.push(
    check(
      G,
      "Unsplit rows all on 1101",
      "yes",
      unsplit.every((r) => r.bankNumber === "1101") ? "yes" : "no",
    ),
  );
  for (const [cls, n] of Object.entries(TARGET_B.unsplitByClass)) {
    out.push(
      check(
        G,
        `Unsplit rows with class ${cls}`,
        n,
        unsplit.filter((r) => r.className === cls).length,
      ),
    );
  }
  const prov1101 = rows.filter((r) => r.className === "Providence" && r.bankNumber === "1101");
  out.push(
    check(
      G,
      "Providence rows paid from 1101 (bridged)",
      TARGET_B.providenceOn1101,
      prov1101.length,
    ),
  );
  out.push(
    check(
      G,
      "Net of those rows",
      TARGET_B.providenceOn1101Net,
      sum(prov1101.map((r) => r.amountCents)),
    ),
  );
  out.push(
    check(
      G,
      `…of which dated before ${TARGET_B.plaLaunchPlaceholder} (placeholder PLA launch, D2)`,
      TARGET_B.providenceOn1101BeforeLaunch,
      prov1101.filter((r) => r.date < TARGET_B.plaLaunchPlaceholder).length,
    ),
  );
  const gen1103 = rows.filter((r) => r.className === "General" && r.bankNumber === "1103");
  out.push(
    check(
      G,
      "General rows on the PLA bank (no bridge needed)",
      TARGET_B.generalOn1103,
      gen1103.length,
    ),
  );
  for (const [acct, n] of Object.entries(TARGET_B.generalOn1103ByAccount)) {
    out.push(
      check(
        G,
        `…of which on account ${acct}`,
        n,
        gen1103.filter((r) => r.accountNumber === acct).length,
      ),
    );
  }
  const otherCross = rows.filter(
    (r) => isCrossEntityRow(r) && !(r.className === "Providence" && r.bankNumber === "1101"),
  );
  out.push(
    check(
      G,
      "Other cross-entity rows (e.g. Providence via Venmo)",
      String(otherCross.length),
      String(otherCross.length),
      {
        critical: false,
        note: otherCross.length
          ? `#${otherCross.map((r) => r.ref).join(", #")} — bridged like the 1101 rows`
          : undefined,
      },
    ),
  );
  out.push(
    check(
      G,
      "Rows filled in by Jose (verified_by_owner)",
      TARGET_B.joseRows,
      rows.filter((r) => r.verifiedByOwner).length,
    ),
  );
  out.push(
    check(
      G,
      "Rows with a blank “Filled in by”",
      TARGET_B.blankFilledInBy,
      rows.filter((r) => !r.filledInBy).length,
    ),
  );
  out.push(
    check(
      G,
      "Distinct “Filled in by” values",
      TARGET_B.distinctFilledInBy,
      new Set(rows.map((r) => r.filledInBy).filter(Boolean)).size,
    ),
  );
  const receiptRows = rows.filter((r) => r.receipts > 0);
  out.push(check(G, "Rows with receipts on file", TARGET_B.receiptRows, receiptRows.length));
  out.push(
    check(
      G,
      "Receipt files expected",
      TARGET_B.receiptFiles,
      receiptRows.reduce((t, r) => t + r.receipts, 0),
    ),
  );
  for (const [n, count] of Object.entries(TARGET_B.receiptDistribution)) {
    out.push(
      check(
        G,
        `Rows with ${n} receipt${n === "1" ? "" : "s"}`,
        count,
        rows.filter((r) => r.receipts === Number(n)).length,
      ),
    );
  }
  out.push(
    check(
      G,
      "Distinct Row IDs",
      TARGET_B.distinctRowIds,
      new Set(rows.map((r) => r.rowId).filter(Boolean)).size,
    ),
  );
  out.push(
    check(
      G,
      "Blank Row IDs (all Venmo)",
      TARGET_B.blankRowIds,
      rows.filter((r) => !r.rowId).length,
    ),
  );
  out.push(
    check(
      G,
      "Blank Row IDs are Venmo rows",
      "yes",
      rows.filter((r) => !r.rowId).every((r) => r.bankNumber === "1104") ? "yes" : "no",
      { critical: false },
    ),
  );
  out.push(
    check(G, "Rows with a user note", TARGET_B.userNoteRows, rows.filter((r) => r.userNote).length),
  );
  out.push(
    check(
      G,
      "Rows with a ledger (system) note",
      TARGET_B.ledgerNoteRows,
      rows.filter((r) => r.ledgerNote).length,
    ),
  );
  out.push(
    check(
      G,
      "Expense-account rows with a positive amount (refunds)",
      TARGET_B.positiveExpenseRows,
      rows.filter((r) => r.accountNumber?.startsWith("5") && r.amountCents > 0n).length,
    ),
  );
  const groups = sameDayGroups(rows);
  out.push(
    check(
      G,
      "Same-day identical groups (kept, flagged in the report)",
      TARGET_B.sameDayGroups,
      groups.length,
    ),
  );
  out.push(
    check(
      G,
      "Rows in those groups",
      TARGET_B.sameDayRows,
      groups.reduce((t, g) => t + g.length, 0),
    ),
  );
  const mcGovern = rows.filter(
    (r) => r.date === "2025-01-07" && r.vendor === "McGovern" && r.amountCents === $("−135.15"),
  );
  out.push(
    check(
      G,
      "McGovern −135.15 on 2025-01-07",
      TARGET_B.mcGovernRefs.map((n) => `#${n}`).join(", "),
      mcGovern.map((r) => `#${r.ref}`).join(", "),
    ),
  );
  out.push(
    check(
      G,
      "Every row Confirmed / Ready",
      "yes",
      rows.every((r) => r.status === "Confirmed" && r.readiness === "Ready") ? "yes" : "no",
      { critical: false },
    ),
  );
  out.push(
    check(
      G,
      "Formula cells with no cached value (read as empty)",
      0,
      x.formulaCellsWithoutCachedResult,
      { critical: false },
    ),
  );
  out.push(
    check(G, "Amounts with fractions of a cent", 0, x.subCentAmounts.length, { critical: false }),
  );
  return out;
}

export function summarise(checks: Check[]): {
  total: number;
  failed: number;
  criticalFailed: number;
} {
  return {
    total: checks.length,
    failed: checks.filter((c) => !c.ok).length,
    criticalFailed: checks.filter((c) => !c.ok && c.critical).length,
  };
}
