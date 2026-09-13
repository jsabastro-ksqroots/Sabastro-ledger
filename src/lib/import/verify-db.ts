import type { DbOrTx } from "@/lib/db";
import {
  CLASS_SUBTYPE_2024,
  CLASS_SUBTYPE_FULL,
  CLASSES_A,
  SUB_TYPES,
  TARGET_A,
  TARGET_B,
  type SubType,
} from "./checklist";
import { cents, SOURCE_A, SOURCE_B, type Check } from "./types";

/**
 * The acceptance numbers read back from the database after the load (inside the same database
 * transaction, before commit). Live, non-bridge lines of POSTED transactions are what reports will read,
 * so that is what is summed here.
 */

type Row = Record<string, unknown>;

function num(v: unknown): number {
  return typeof v === "bigint" ? Number(v) : Number(v ?? 0);
}
function big(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (v === null || v === undefined) return 0n;
  return BigInt(String(v).split(".")[0] as string);
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

async function classSubTypeFromDb(
  tx: DbOrTx,
  sourceFile: string,
  from: string | null,
): Promise<Record<string, Partial<Record<SubType, bigint>>>> {
  const rows = await tx.$queryRaw<Row[]>`
    SELECT c."name" AS class, a."sub_type" AS sub_type, sum(l."debit_cents" - l."credit_cents")::bigint AS net
    FROM "transaction_lines" l
    JOIN "transactions" t ON t."id" = l."transaction_id"
    JOIN "accounts" a ON a."id" = l."account_id"
    JOIN "classes" c ON c."id" = l."class_id"
    WHERE t."source_file" = ${sourceFile} AND t."status" = 'POSTED'
      AND l."superseded_at" IS NULL AND NOT l."is_bridge"
      AND (${from}::date IS NULL OR t."date" >= ${from}::date)
    GROUP BY 1, 2`;
  const out: Record<string, Partial<Record<SubType, bigint>>> = {};
  for (const r of rows) {
    const cls = String(r.class);
    const st = String(r.sub_type) as SubType;
    (out[cls] ??= {})[st] = big(r.net);
    (out.TOTAL ??= {})[st] = ((out.TOTAL ?? {})[st] ?? 0n) + big(r.net);
  }
  return out;
}

function tableChecks(
  group: string,
  expected: Record<string, Partial<Record<SubType, bigint>>>,
  actual: Record<string, Partial<Record<SubType, bigint>>>,
): Check[] {
  const out: Check[] = [];
  for (const cls of [...CLASSES_A, "TOTAL"]) {
    for (const st of SUB_TYPES) {
      const e = expected[cls]?.[st] ?? 0n;
      const a = actual[cls]?.[st] ?? 0n;
      if (e === 0n && a === 0n && st === "Other Current Assets") continue;
      out.push(check(group, `${cls} · ${st}`, e, a));
    }
  }
  for (const cls of Object.keys(actual)) {
    if (!(cls in expected))
      out.push(check(group, `${cls} (unexpected class)`, "absent", "present"));
  }
  return out;
}

export interface DbExpectations {
  /** Cross-entity rows of Workbook B (the 89 Providence rows on 1101 plus any others, e.g. via Venmo). */
  bridgedRowsB: number;
  /** How the reader classified the 2019–2024 entries (bank / journal / adjusting), voided placeholders excluded. */
  kindsA: { BANK: number; JOURNAL: number; ADJUSTING: number };
  referenceModelsPerYear: Record<number, number>;
}

export async function checksFromDatabase(tx: DbOrTx, expect: DbExpectations): Promise<Check[]> {
  const out: Check[] = [];
  const A = "Database · 2019–2024";
  const B = "Database · 2025";

  // ---- Workbook A ----
  const statusA = await tx.$queryRaw<Row[]>`
    SELECT "status"::text AS status, count(*)::int AS n FROM "transactions" WHERE "source_file" = ${SOURCE_A} GROUP BY 1`;
  const byStatusA = Object.fromEntries(statusA.map((r) => [String(r.status), num(r.n)]));
  out.push(
    check(
      A,
      "Posted transactions",
      TARGET_A.entryCount - TARGET_A.zeroAmountEntries.length,
      byStatusA.POSTED ?? 0,
    ),
  );
  out.push(
    check(
      A,
      "Voided placeholders (P0-3)",
      TARGET_A.zeroAmountEntries.length,
      byStatusA.VOIDED ?? 0,
    ),
  );
  out.push(
    check(A, "Drafts or flagged rows", 0, (byStatusA.DRAFT ?? 0) + (byStatusA.FLAGGED ?? 0)),
  );

  const linesA = await tx.$queryRaw<Row[]>`
    SELECT extract(year FROM t."date")::int AS year, count(*)::int AS n,
           sum(l."debit_cents")::bigint AS dr, sum(l."credit_cents")::bigint AS cr,
           count(*) FILTER (WHERE l."is_bridge")::int AS bridge,
           count(*) FILTER (WHERE l."entity_id" <> t."entity_id")::int AS foreign_lines
    FROM "transaction_lines" l JOIN "transactions" t ON t."id" = l."transaction_id"
    WHERE t."source_file" = ${SOURCE_A} AND l."superseded_at" IS NULL
    GROUP BY 1 ORDER BY 1`;
  let totalLines = 0;
  let dr = 0n;
  let cr = 0n;
  let bridge = 0;
  let foreign = 0;
  for (const r of linesA) {
    const year = num(r.year);
    const expectedLines =
      (TARGET_A.linesPerYear[year] ?? 0) - (year === 2024 ? TARGET_A.zeroAmountEntries.length : 0);
    out.push(check(A, `Live lines dated ${year}`, expectedLines, num(r.n)));
    totalLines += num(r.n);
    dr += big(r.dr);
    cr += big(r.cr);
    bridge += num(r.bridge);
    foreign += num(r.foreign_lines);
  }
  out.push(check(A, "Live lines in all", TARGET_A.linesWithAmounts, totalLines));
  out.push(check(A, "Σ debits", TARGET_A.normalisedTotal, dr));
  out.push(check(A, "Σ credits", TARGET_A.normalisedTotal, cr));
  out.push(check(A, "Bridge lines (all SREI, so none expected)", 0, bridge));
  out.push(check(A, "Lines attributed to another entity than the header", 0, foreign));
  out.push(
    ...tableChecks(
      "Database · 2019–2024 class × sub-type (all years)",
      CLASS_SUBTYPE_FULL,
      await classSubTypeFromDb(tx, SOURCE_A, null),
    ),
  );
  out.push(
    ...tableChecks(
      "Database · 2024 class × sub-type (workbook pivot)",
      CLASS_SUBTYPE_2024,
      await classSubTypeFromDb(tx, SOURCE_A, "2024-01-01"),
    ),
  );
  const bank = await tx.$queryRaw<Row[]>`
    SELECT a."number" AS number, sum(l."debit_cents" - l."credit_cents")::bigint AS net
    FROM "transaction_lines" l JOIN "transactions" t ON t."id" = l."transaction_id" JOIN "accounts" a ON a."id" = l."account_id"
    WHERE t."source_file" = ${SOURCE_A} AND t."status" = 'POSTED' AND l."superseded_at" IS NULL AND a."number" IN ('1101','1102','1103','1104')
    GROUP BY 1`;
  const bankNet = Object.fromEntries(bank.map((r) => [String(r.number), big(r.net)]));
  out.push(
    check(A, "1101 balance at 2024-12-31 (ledger)", TARGET_A.bank1101At2024, bankNet["1101"] ?? 0n),
  );
  out.push(
    check(A, "1102 balance at 2024-12-31 (ledger)", TARGET_A.bank1102At2019, bankNet["1102"] ?? 0n),
  );
  out.push(
    check(
      A,
      "1103 / 1104 postings in 2019–2024",
      0,
      num(bankNet["1103"] ?? 0n) + num(bankNet["1104"] ?? 0n),
    ),
  );
  const kinds = await tx.$queryRaw<Row[]>`
    SELECT "kind"::text AS kind, count(*)::int AS n FROM "transactions" WHERE "source_file" = ${SOURCE_A} AND "status" = 'POSTED' GROUP BY 1`;
  const kindMap = Object.fromEntries(kinds.map((r) => [String(r.kind), num(r.n)]));
  out.push(
    check(
      A,
      "Posted entries stored as bank / journal / adjusting",
      `${expect.kindsA.BANK} / ${expect.kindsA.JOURNAL} / ${expect.kindsA.ADJUSTING}`,
      `${kindMap.BANK ?? 0} / ${kindMap.JOURNAL ?? 0} / ${kindMap.ADJUSTING ?? 0}`,
      { critical: false },
    ),
  );

  // ---- Workbook B ----
  const statusB = await tx.$queryRaw<Row[]>`
    SELECT "status"::text AS status, count(*)::int AS n FROM "transactions" WHERE "source_file" = ${SOURCE_B} GROUP BY 1`;
  const byStatusB = Object.fromEntries(statusB.map((r) => [String(r.status), num(r.n)]));
  out.push(
    check(
      B,
      "Transactions imported",
      TARGET_B.rowCount,
      statusB.reduce((t, r) => t + num(r.n), 0),
    ),
  );
  out.push(
    check(B, "Posted", TARGET_B.rowCount - TARGET_B.splitRows.length, byStatusB.POSTED ?? 0),
  );
  out.push(
    check(B, "Flagged drafts (the split row)", TARGET_B.splitRows.length, byStatusB.FLAGGED ?? 0),
  );
  const bankB = await tx.$queryRaw<Row[]>`
    SELECT a."number" AS number, count(*)::int AS n, sum(l."debit_cents" - l."credit_cents")::bigint AS net
    FROM "transaction_lines" l JOIN "transactions" t ON t."id" = l."transaction_id" JOIN "accounts" a ON a."id" = l."account_id"
    WHERE t."source_file" = ${SOURCE_B} AND l."superseded_at" IS NULL AND a."number" IN ('1101','1102','1103','1104')
    GROUP BY 1`;
  const bankRows = Object.fromEntries(
    bankB.map((r) => [String(r.number), { n: num(r.n), net: big(r.net) }]),
  );
  for (const [n, expected] of Object.entries(TARGET_B.byBank)) {
    out.push(check(B, `Bank lines on ${n}`, expected, bankRows[n]?.n ?? 0));
  }
  out.push(
    check(
      B,
      "Net cash movement across 1101 + 1103 + Venmo",
      TARGET_B.amountSum,
      Object.values(bankRows).reduce((t, r) => t + r.net, 0n),
    ),
  );
  const misc = await tx.$queryRaw<Row[]>`
    SELECT
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "transaction_lines" l WHERE l."transaction_id" = t."id" AND l."is_bridge" AND l."superseded_at" IS NULL))::int AS bridged,
      count(*) FILTER (WHERE t."needs_model_split")::int AS unsplit,
      count(*) FILTER (WHERE t."verified_by_owner")::int AS jose,
      coalesce(sum(t."receipt_expected_count"), 0)::int AS receipts,
      count(*) FILTER (WHERE t."receipt_expected_count" > 0)::int AS receipt_rows,
      count(*) FILTER (WHERE jsonb_array_length(t."flags") > 0)::int AS flagged_with_reason,
      count(*) FILTER (WHERE t."source_ref_2" IS NOT NULL)::int AS with_row_id,
      count(*) FILTER (WHERE t."filled_in_by" IS NULL)::int AS blank_filled_in_by,
      count(*) FILTER (WHERE t."entity_id" = (SELECT "id" FROM "entities" WHERE "code" = 'SREI'))::int AS home_srei,
      count(*) FILTER (WHERE t."entity_id" = (SELECT "id" FROM "entities" WHERE "code" = 'PLA'))::int AS home_pla
    FROM "transactions" t WHERE t."source_file" = ${SOURCE_B}`;
  const m = misc[0] ?? {};
  out.push(check(B, "Rows with cross-entity bridge lines", expect.bridgedRowsB, num(m.bridged)));
  out.push(check(B, "Rows tagged needs_model_split", TARGET_B.unsplitRows, num(m.unsplit)));
  out.push(check(B, "Rows verified by Jose", TARGET_B.joseRows, num(m.jose)));
  out.push(check(B, "Rows expecting receipts", TARGET_B.receiptRows, num(m.receipt_rows)));
  out.push(check(B, "Receipt files expected", TARGET_B.receiptFiles, num(m.receipts)));
  out.push(
    check(B, "Rows carrying a flag reason", TARGET_B.splitRows.length, num(m.flagged_with_reason)),
  );
  out.push(
    check(B, "Rows with a Row ID", TARGET_B.rowCount - TARGET_B.blankRowIds, num(m.with_row_id)),
  );
  out.push(
    check(
      B,
      "Rows with a blank “Filled in by”",
      TARGET_B.blankFilledInBy,
      num(m.blank_filled_in_by),
    ),
  );
  out.push(
    check(
      B,
      "Home entity SREI (1101 + Venmo rows)",
      TARGET_B.byBank["1101"] + TARGET_B.byBank["1104"],
      num(m.home_srei),
    ),
  );
  out.push(check(B, "Home entity PLA (1103 rows)", TARGET_B.byBank["1103"], num(m.home_pla)));
  const notes = await tx.$queryRaw<Row[]>`
    SELECT n."kind"::text AS kind, count(*)::int AS n FROM "notes" n JOIN "transactions" t ON t."id" = n."transaction_id"
    WHERE t."source_file" = ${SOURCE_B} GROUP BY 1`;
  const noteMap = Object.fromEntries(notes.map((r) => [String(r.kind), num(r.n)]));
  out.push(check(B, "User notes carried over", TARGET_B.userNoteRows, noteMap.USER ?? 0));
  out.push(
    check(
      B,
      "System notes (provenance + snapshot ledger notes + import notes)",
      ">= " + (TARGET_B.rowCount + TARGET_B.ledgerNoteRows),
      (noteMap.SYSTEM ?? 0) >= TARGET_B.rowCount + TARGET_B.ledgerNoteRows
        ? ">= " + (TARGET_B.rowCount + TARGET_B.ledgerNoteRows)
        : String(noteMap.SYSTEM ?? 0),
      { critical: false },
    ),
  );
  const prov = await tx.$queryRaw<Row[]>`
    SELECT count(*)::int AS n, coalesce(sum(l."debit_cents" - l."credit_cents"), 0)::bigint AS net
    FROM "transactions" t
    JOIN "bank_accounts" b ON b."id" = t."bank_account_id" JOIN "accounts" ba ON ba."id" = b."account_id"
    JOIN "transaction_lines" l ON l."transaction_id" = t."id" AND l."superseded_at" IS NULL AND l."account_id" = b."account_id"
    WHERE t."source_file" = ${SOURCE_B} AND ba."number" = '1101'
      AND EXISTS (SELECT 1 FROM "transaction_lines" x JOIN "classes" c ON c."id" = x."class_id" WHERE x."transaction_id" = t."id" AND x."superseded_at" IS NULL AND NOT x."is_bridge" AND c."name" = 'Providence')`;
  out.push(check(B, "Providence rows on 1101", TARGET_B.providenceOn1101, num(prov[0]?.n)));
  out.push(
    check(B, "Net of the Providence rows on 1101", TARGET_B.providenceOn1101Net, big(prov[0]?.net)),
  );

  // ---- Tax years and reference models ----
  const years = await tx.$queryRaw<Row[]>`
    SELECT e."code" AS code, ty."year" AS year, ty."state"::text AS state FROM "tax_years" ty JOIN "entities" e ON e."id" = ty."entity_id" ORDER BY 1, 2`;
  const stateOf = (code: string, year: number) =>
    String(years.find((r) => String(r.code) === code && num(r.year) === year)?.state ?? "missing");
  for (const y of [2019, 2020, 2021, 2022, 2023, 2024])
    out.push(check("Tax years", `SREI ${y}`, "FILED", stateOf("SREI", y)));
  out.push(check("Tax years", "SREI 2025", "OPEN", stateOf("SREI", 2025)));
  out.push(check("Tax years", "PLA 2025", "OPEN", stateOf("PLA", 2025)));
  out.push(
    check(
      "Tax years",
      "PLA years before 2025",
      "none",
      years.filter((r) => String(r.code) === "PLA" && num(r.year) < 2025).length === 0
        ? "none"
        : years
            .filter((r) => String(r.code) === "PLA" && num(r.year) < 2025)
            .map((r) => num(r.year))
            .join(", "),
      { critical: false },
    ),
  );
  const models = await tx.$queryRaw<Row[]>`
    SELECT ty."year" AS year, count(*)::int AS n FROM "allocation_models" m JOIN "tax_years" ty ON ty."id" = m."tax_year_id" WHERE m."is_reference" AND m."source_key" IS NOT NULL GROUP BY 1 ORDER BY 1`;
  for (const [year, n] of Object.entries(expect.referenceModelsPerYear)) {
    out.push(
      check(
        "Reference models",
        `${year} models archived`,
        n,
        num(models.find((r) => num(r.year) === Number(year))?.n ?? 0),
      ),
    );
  }
  return out;
}
