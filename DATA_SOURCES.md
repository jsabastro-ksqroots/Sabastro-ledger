# DATA_SOURCES.md — the two source workbooks and how to import them

> **Counts corrected 2026-09-12 (Phase 0).** Both workbooks were re-verified with `openpyxl`; see
> `docs/WORKBOOK_VERIFICATION.md` for the evidence and the reconciliation tables. Where a number below
> differs from that file, **that file wins**. Corrections: Workbook A has **7,144** journal lines (2020:
> 1,438 · 2021: 1,037 · 2023: 1,431), not 7,090; the Region 3 pivot's cached values cover **2024 only**;
> 43 lines carry negative debits (Σ −5,862.32; see DECISIONS P0-1); four 2024-07-12 entries have a single
> zero-amount line (P0-3); ~1,781 lines have an empty Name. Workbook B has **93** "unsplit" rows whose
> ledger note starts (after a leading space) with `[Unsplit 2026-09-10`, three (not two) identical
> `McGovern −135.15` rows on 2025-01-07, and two trailer rows below the table that have no `#`.

> **Corrections 2026-09-13 (Phase 2 import, see `docs/IMPORT_REPORT.md` and DECISIONS P2-4, P2-9, P2-16).**
> The 43 negative cells are **25 negative debits and 18 negative credits** (each side Σ −5,862.32); four 2024
> entries (2264, 2531, 2724, 2898) carry two dates; 194 amounts in the 2023 reallocation entries have
> fractions of a cent; "Filled in by" has **31** distinct values and there are **797** distinct Row IDs
> (the earlier counts included the blank); **92** 2025 rows are cross-entity (89 Providence on `1101`
> plus 3 Providence via Venmo: #818, #843, #850); same-day identical rows = 7 groups / 15 rows on the key
> (bank, date, amount). Twelve 2024 Transaction #s (2264, 2327, 2374, 2428, 2480, 2531, 2598, 2658, 2724,
> 2779, 2831, 2898) cover two bookings each — the monthly Clubhouse rent booking and the next bank item —
> and seven entries (353, 504, 571, 928, 942, 947, 1034) are a payment and its reversal on `1101` (P2-3,
> P2-18). The import reproduces every money figure below to the cent.

Both files live in `data/source/` (git-ignored). Everything below was verified by opening the files with `openpyxl`; re-verify counts in your import report.

| File                                                                                                                                                          | Covers                                                                                                                     | Sheets                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `data/source/2019-2024_SREI_general-ledger_and_tax-worksheets.xlsx` (original name `Sabastro_RE_Inv_GL_2025_v1.xlsx`)                                         | SREI only, 2019-04-01 → 2024-12-31, **true double-entry**, plus per-year allocation worksheets                             | `General Ledger`, `2024 Tax Worksheet`, `2023 Tax Worksheet`, `2022 Tax Worksheet`, `2021 Tax Worksheet`, `2020 Tax Worksheet` |
| `data/source/2025_SREI-PLA_general-ledger_final-review-snapshot_2026-09-10.xlsx` (original name `FINAL_COPY_2025_General_Ledger_-_all_814_transactions.xlsx`) | SREI + PLA, calendar 2025, **single-line bank-centric rows**, fully reviewed by Jose and Jamin (every row Confirmed/Ready) | `Transactions`, `Summary`, `Questions for Jose`                                                                                |

Read both with `openpyxl` using `read_only=True, data_only=True` (cached formula values). Do not trust `ws.max_row`; iterate.

---

## Workbook A — 2019–2024 general ledger (SREI)

### Sheet `General Ledger` — three side-by-side regions

**Region 1 — journal lines (columns B–O, header in row 2, data from row 3).** Column A is empty.

| Col | Header          | Notes                                                                                                                                 |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| B   | `Transaction #` | Formula (running-balance trick) — use the **cached value**. Groups lines into transactions. 1 … 2999.                                 |
| C   | `Date`          | datetime; use `.date()`                                                                                                               |
| D   | `Name`          | Vendor / payee. Empty (`None` or `''`) on ~1,650 lines — mostly the bank-side line of an entry; fall back to the sibling line's name. |
| E   | `Memo`          | Free text, often the raw bank description                                                                                             |
| F   | `Account`       | `"NNNN Name"` string; split on first space → account number                                                                           |
| G   | `Class`         | Class string. Four cells contain a formula like `=G2124`; cached value resolves it.                                                   |
| H   | `Debit`         | number                                                                                                                                |
| I   | `Credit`        | number; ~195 cells are formulas (`=H3`); cached value resolves them                                                                   |
| J   | `Entry`         | derived (debit − credit within the pivot date range) — ignore                                                                         |
| K   | `BS Type`       | derived by VLOOKUP from the chart — ignore, rebuild from the seed                                                                     |
| L   | `Sub Type`      | derived — ignore                                                                                                                      |
| M   | `Sub Typr 2`    | derived — ignore                                                                                                                      |
| N   | `Error Check 1` | ignore                                                                                                                                |
| O   | `Error Check 2` | ignore                                                                                                                                |

Verified facts to reproduce in the import report:

- 7,090 lines, 2,999 transactions, dates 2019-04-01 → 2024-12-31.
- Lines per year: 2019: 186 · 2020: 1,426 · 2021: 1,013 · 2022: 1,403 · 2023: 1,413 · 2024: 1,649.
- Total debits = total credits = **13,291,914.04**; every transaction group balances to 0.00.
- Accounts used: 67, all present in the chart-of-accounts region.
- Bank account `1101` used every year (ending cumulative balance 2024-12-31: **523.80**); `1102` used only in 2019 (ends at 0.00); `1103` never used in 2019–2024 (it becomes PLA's account in 2025).
- Cumulative by type at 2024-12-31 (debit-positive): Asset 2,183,960.10 · Liability −5,725.00 · Equity (incl. income/expense) −2,178,235.10.
- Classes and active years: `General` 2019–24 · `Rentals:142 Maloney Terrace` 2019–24 · `Rentals:The Clubhouse` 2020–24 · `Rentals:The Shed` 2020–24 · `Land Development:13 Chisel Creek Dr` 2020–24 · `Flips:1 Mystery Rose` 2020 only · `Rentals:176 Tulsk Road` 2021–24 · `Rentals:544 Liberty Circle` 2021–24 · `Rentals:533 Mystic Lane` 2022–24 · `Land Development:1671-1675 New London Rd` 2023–24 · `Rentals:136 Sunnyside` 2024.

**Region 2 — chart of accounts (columns Q–U, header row 2, ~74 rows).** `Parent group | Account ("NNNN Name") | Type | Sub Type | Sub Type 2`. Quirks: Income and Expense accounts are typed `Equity` in this workbook (fix: type by sub-type); `1501 Tenant Rent Due` appears twice (as Asset under 1500 and as Liability under 2100) — keep one Asset account. A cleaned version is already in `seed/chart_of_accounts.csv`; use the seed, and diff it against the workbook in the import report.

**Region 3 — pivot (columns W onward).** `Sum of Entry` by BS Type × Class for 2019-01-01 → 2024-12-31. Use it as a **reconciliation target**: after import, your per-class totals by type must match this table (e.g., Fixed Asset for `Rentals:136 Sunnyside` = 338,577.80; Income for `Rentals:The Clubhouse` = −36,000.00; Expense grand total = 301,554.05; Income grand total = −127,544.98).

### Sheets `2020`–`2024 Tax Worksheet` — the allocation models by year

These are the year-end "models". Each year's layout differs, which is exactly why the app needs a proper model system. What they contain (import as archived reference models with their parameters; do not re-apply):

- **Basis inputs:** per-property acres and assigned values (e.g., 2024: 1671-1675 = 5.6 ac / 350,000; The Shed 2.2 ac / 300,000; The Clubhouse 15 ac / 500,000; 13 Chisel Creek land = remaining acres of 115 valued at per-lot 120,000 × 10 lots + per-acre 10,000; "Our House" 30 ac / 1,300,000 = personal; 176 Tulsk, 142 Maloney, 544 Liberty, 136 Sunnyside 380,000 each).
- **Percentage sets** derived from those weights: `% (all)` on value across every property; `% Just Chisel Creek Land` (Shed, Clubhouse, land, house); `% Just 1625` (Clubhouse, land, house — for the parcel's township/county/school tax); 2022 adds `% (no Shed)`, `% (no house)`, `% (no shed/house)` and a months-in-service weighting; 2021/2020 use `% of Land Expenses` / `% of Other Expenses` / `Expenses with no Shed` / `Expenses with no personal house`.
- **Specific-bill allocations:** umbrella insurance total, Chisel Creek insurance total, Franklin Township / Chester County / Avon Grove School District tax for the 1625 parcel — split across properties with the personal-house share going to distributions.
- **"Reallocation of General Expenses"** (2023, 2024): for each expense account, the General-class total for the year is spread across properties using a chosen percentage set, remainder to the first column. This is the report the app's Phase 6 "Reallocation" view should reproduce.
- Miscellany also on these tabs (Shed rental payment lists by payer, Clubhouse rent math, purchase-price/closing-cost breakdowns for acquisitions, assessment/common-level-ratio math). Capture as attachments/notes on the reference model, not as data.

---

## Workbook B — 2025 ledger snapshot (SREI + PLA)

### Sheet `Transactions` — header row 1, 833 data rows (the title says 814; the count is 833)

| Col | Header                  | Import as                                                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | `#`                     | source row number (1…850, gaps; unique) → keep as `source_ref`                                                                                                                                                                                                                                                                                           |
| B   | `Date`                  | transaction date (2025-01-01 → 2025-12-31)                                                                                                                                                                                                                                                                                                               |
| C   | `Amount`                | signed: **negative = money out**, positive = money in. Sum = +10,891.95 (in 310,679.28; out −299,787.33)                                                                                                                                                                                                                                                 |
| D   | `Vendor`                | vendor name                                                                                                                                                                                                                                                                                                                                              |
| E   | `Status`                | all `Confirmed` — ignore                                                                                                                                                                                                                                                                                                                                 |
| F   | `Readiness`             | all `Ready` — ignore                                                                                                                                                                                                                                                                                                                                     |
| G   | `Checked?`              | review artifact — ignore                                                                                                                                                                                                                                                                                                                                 |
| H   | `Account`               | `"NNNN Name"`; 29 distinct. One row (#464, Eureka Ergonomic, −7,804.25) says `(split - varies)` — see quirks                                                                                                                                                                                                                                             |
| I   | `Class`                 | 11 distinct: `Providence` 255 · `General` 191 · `Rentals:176 Tulsk Road` 85 · `Rentals:The Shed` 74 · `Rentals:136 Sunnyside` 60 · `Rentals:142 Maloney Terrace` 57 · `Rentals:544 Liberty Circle` 46 · `Maintenance Business` 33 · `Rentals:The Clubhouse` 16 · `Land Development:13 Chisel Creek Dr` 14 · `Land Development:1671-1675 New London Rd` 2 |
| J   | `Bank account`          | `Real Estate (1101)` 623 · `PLA (1103)` 172 · `Venmo` 38                                                                                                                                                                                                                                                                                                 |
| K   | `Full bank description` | raw statement text; empty on many Venmo rows                                                                                                                                                                                                                                                                                                             |
| L   | `Ledger note`           | → **System notes** (these were written by the tool that produced the snapshot)                                                                                                                                                                                                                                                                           |
| M   | `My notes / answer`     | → **User notes** (mostly blank / a single space)                                                                                                                                                                                                                                                                                                         |
| N   | `Row ID`                | 8-hex id from the source tool; 798 distinct across 833 rows — keep as `source_ref_2`, do not rely on uniqueness                                                                                                                                                                                                                                          |
| O   | `Receipts`              | count of receipts on file (1–3) on 121 rows; the files themselves are **not** in the workbook — Jamin will supply them; create placeholder "receipt expected" flags                                                                                                                                                                                      |
| P   | `Filled in by`          | provenance ("Jose's worksheet", "Emilio texts", "PECO account … bills", "Sweep 2026-09-10, pattern default", …). Rows sourced from Jose are the "green" verified rows → store as `source` and set `verified_by_owner = true` when the value starts with "Jose"                                                                                           |

**Converting each row to a journal entry.** Let `A` = amount, `acct` = column H, `bank` = the bank account from column J (`1101`, `1103`, or `1104 Venmo`):

- `A < 0` → `Dr acct |A|`, `Cr bank |A|`
- `A > 0` → `Dr bank A`, `Cr acct A`

This rule is correct for every account type in the file (e.g., −500 to `3102 Capital Distribution` → Dr 3102 / Cr bank; +1,000 to `3101` → Dr bank / Cr 3101; +900 security deposit received via Venmo to `2101` → Dr Venmo / Cr 2101; −900 returned → Dr 2101 / Cr Venmo). Entity of the entry = entity of the bank account; apply the cross-entity bridge rule from `CLAUDE.md` for the 89 `Providence`-class rows paid from `1101` and the 9 `General`-class rows on `1103` (review these in the import report rather than bridging blindly — the 9 `General` on PLA are probably contributions/distributions on the PLA account and need no bridge).

**Quirks to handle explicitly**

1. Row #464 `(split - varies)`: the only split still carried; it is a capitalize-vs-expense split (furniture `1313` vs supplies `5215`) whose item-level detail is still an open question for Jose. Import as a **flagged draft** with the full amount on `1313`, not as posted.
2. Same-day identical rows exist and are real (e.g., two `McGovern −135.15` on 2025-01-07). Do not de-duplicate; your duplicate detector should flag, not drop.
3. Accounts used in 2025 that are not in Workbook A's chart: `1313`, `1315`, `4103`, `5226`, `5227` — already added to `seed/chart_of_accounts.csv` with inferred parents (confirm).
4. `Venmo` has no account number in either workbook; the seed proposes `1104 Venmo`.
5. 91 rows were "unsplit back to General" on 2026-09-10 pending the model system; their `Ledger note` starts with `[Unsplit 2026-09-10`. Tag them `needs_model_split = true` so Phase 5 can find them.
6. Bank descriptions contain card last-4 and confirmation numbers; fine to store, never log.
7. The `Summary` sheet says the file was "pulled live from the shared ledger" and that "the live app has the same green marker". Ask Jamin whether that app/database still exists (decision D8 in `CLAUDE.md`).

### Sheet `Questions for Jose` — open items that shape the build

Read it in full. Items that become app features or seed data: the SRC / Maintenance Business correction (accounts `1315`, `4103`); the 2025 depreciation (~$60k) not yet in the books; wages booked at net; the sole-proprietor pre-PLA report; and item 16 — the allocation-model system spec (one model per tax year, live-linked transactions, retroactive re-split on edit, warning with confirmed/draft counts, full version history with revert). `CLAUDE.md` already incorporates item 16.

---

## Import acceptance checklist (Phase 2)

- [ ] 2019–2024: 2,999 entries / 7,144 source lines (7,140 imported with amounts + 4 zero-amount entries as voided headers, P0-3); signed Dr = Cr = 13,291,914.04 in the source, 13,303,638.68 each after negative-debit normalisation (P0-1); zero unbalanced entries.
- [ ] Per-class × sub-type totals for 2019–2024 match the table in `docs/WORKBOOK_VERIFICATION.md` to the cent, and the 2024-only figures match Workbook A's pivot; `1101` balance at 2024-12-31 = 523.80.
- [ ] 2025: 833 rows (the importer stops at the first row whose `#` is not an integer) → 833 entries (832 posted + 1 flagged draft); net cash movement +10,891.95; 623 / 172 / 38 lines on 1101 / 1103 / Venmo; 93 rows tagged `needs_model_split` (trimmed note starts with `[Unsplit 2026-09-10`).
- [ ] Every line has a valid account and class from the seed; unknown values halt the import with a clear message (no silent creation).
- [ ] Provenance preserved: source row `#`, Row ID, "Filled in by", both notes fields, receipt-expected count.
- [ ] 2019–2024 tax years set to `filed`; 2025 `open`; reference models 2020–2024 archived with their parameters.
- [ ] `docs/IMPORT_REPORT.md` written with all counts above, the account/class diff vs. the seed, and a list of rows needing human attention.
- [ ] Import is idempotent: running it twice changes nothing (guard on a `source_file` + `source_ref` unique key).
