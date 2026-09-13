# Import report — historical books (Phase 2)

Generated 2026-09-13T12:55:44.149Z by Jamin Smith (cli), run `b334bbde-840e-48cf-a58e-c5099098219f`, 8.2 s. Outcome: **SUCCEEDED**.

**498 of 498 checks pass.** Every critical number ties to the cent.

## Sources

| Workbook | File                                                                 | SHA-256                                                            |    Size |
| -------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ | ------: |
| A        | `2019-2024_SREI_general-ledger_and_tax-worksheets.xlsx`              | `c23bd13337d080533abbae090ffeee6be2a632ec208530fbe7251585d7350dfd` | 1066 KB |
| B        | `2025_SREI-PLA_general-ledger_final-review-snapshot_2026-09-10.xlsx` | `f06a5a07f60b73c4c533362825569f73f387e3c1e72086e0528cbe20e51ac2cc` |  114 KB |

## What was written

|                              | Already present (skipped) | Inserted this run |
| ---------------------------- | ------------------------: | ----------------: |
| 2019–2024 transactions       |                         0 |             2,999 |
| 2025 transactions            |                         0 |               833 |
| Reference models (2020–2024) |                         0 |                28 |

The ledger now holds 2,999 imported 2019–2024 transactions, 833 imported 2025 transactions and 28 reference models.

Closed or filed years that received rows in this run, written under the import's lock override (one audit row for the run, override counts untouched): SREI 2019 (filed), SREI 2020 (filed), SREI 2021 (filed), SREI 2022 (filed), SREI 2023 (filed), SREI 2024 (filed).

Tax years after the run: PLA 2025 open · SREI 2019 filed · SREI 2020 filed · SREI 2021 filed · SREI 2022 filed · SREI 2023 filed · SREI 2024 filed · SREI 2025 open.

## 2019–2024 workbook (double-entry)

7,144 journal lines in 2,999 transactions, 2019-04-01 → 2024-12-31; 7,140 lines carry money. Entries stored as bank transactions / journal entries / adjusting entries by year:

| Year | Bank | Journal | Adjusting |
| ---- | ---: | ------: | --------: |
| 2019 |   83 |       0 |         8 |
| 2020 |  604 |      11 |        21 |
| 2021 |  355 |      18 |        10 |
| 2022 |  493 |       4 |        47 |
| 2023 |  568 |      13 |        28 |
| 2024 |  713 |       5 |        18 |

#### 2019–2024 workbook — 50/50 ✅

All 50 cells match to the cent.

#### 2019–2024 class × sub-type (all years) — 72/72 ✅

All 72 cells match to the cent.

#### 2024 class × sub-type (workbook pivot) — 72/72 ✅

All 72 cells match to the cent.

## 2025 snapshot (single-line rows)

833 rows, 2025-01-01 → 2025-12-31; the reader stopped at sheet row 835. Rows by bank: Real Estate (1101) 623 · PLA (1103) 172 · Venmo 38. 93 rows tagged `needs_model_split` (net -35,662.95; General 67, Providence 13, Rentals:136 Sunnyside 12, Maintenance Business 1). 357 rows verified by Jose. 121 rows expect 129 receipt files (Phase 3).

#### 2025 snapshot — 62/62 ✅

All 62 cells match to the cent.

## Cross-entity rows (bridged per decision D3)

89 Providence-class rows were paid from SREI's 1101 and get bridge lines (SREI Dr 3102 Capital Distribution / PLA Cr 3101 Capital Contribution). 21 of them are dated before the placeholder PLA launch date 2025-06-02 (decision D2) and are candidates for the sole-proprietor report.

|   # | Date       | Vendor                 |  Amount | Account                              | Pre-launch |
| --: | ---------- | ---------------------- | ------: | ------------------------------------ | :--------: |
|  24 | 2025-01-15 | Starbucks              |  -14.47 | 5217 Meals and Entertainment Expense |    yes     |
|  33 | 2025-01-21 | Bardea                 |  -33.00 | 5217 Meals and Entertainment Expense |    yes     |
|  38 | 2025-01-24 | Borough of Kennett     |   -2.35 | 5216 Travel Expense                  |    yes     |
|  47 | 2025-01-29 | Borough of Kennett     |   -2.35 | 5216 Travel Expense                  |    yes     |
|  56 | 2025-01-31 | Borough of Kennett     |   -2.35 | 5216 Travel Expense                  |    yes     |
| 104 | 2025-03-03 | Daddy's Kitchen        |  -47.70 | 5217 Meals and Entertainment Expense |    yes     |
| 119 | 2025-03-06 | Country Butcher        |  -20.14 | 5217 Meals and Entertainment Expense |    yes     |
| 145 | 2025-03-26 | Verizon                | -316.63 | 5205 Utilities Expense               |    yes     |
| 163 | 2025-04-03 | Country Butcher        |  -20.14 | 5217 Meals and Entertainment Expense |    yes     |
| 164 | 2025-04-03 | Country Butcher        |   -9.54 | 5217 Meals and Entertainment Expense |    yes     |
| 168 | 2025-04-03 | Country Butcher        |   -2.12 | 5217 Meals and Entertainment Expense |    yes     |
| 172 | 2025-04-04 | Hank's Place           |  -64.59 | 5217 Meals and Entertainment Expense |    yes     |
| 173 | 2025-04-04 | Café Americana         |  -34.00 | 5217 Meals and Entertainment Expense |    yes     |
| 189 | 2025-04-15 | Verizon                | -144.99 | 5205 Utilities Expense               |    yes     |
| 191 | 2025-04-16 | FINRA                  | -187.00 | 5211 Professional Fees               |    yes     |
| 197 | 2025-04-24 | Aurora's Pizza         |  -28.82 | 5217 Meals and Entertainment Expense |    yes     |
| 200 | 2025-04-25 | Country Butcher        |  -20.14 | 5217 Meals and Entertainment Expense |    yes     |
| 214 | 2025-05-01 | Kaplan                 | -634.94 | 5218 Training Expense                |    yes     |
| 235 | 2025-05-15 | Café Americana         |  -10.49 | 5217 Meals and Entertainment Expense |    yes     |
| 236 | 2025-05-15 | Verizon                |  -94.99 | 5205 Utilities Expense               |    yes     |
| 240 | 2025-05-19 | Talula's               |  -35.96 | 5217 Meals and Entertainment Expense |    yes     |
| 269 | 2025-06-02 | Google                 |   -2.00 | 5214 Software Expense                |            |
| 288 | 2025-06-11 | Philter Coffee         |  -10.80 | 5217 Meals and Entertainment Expense |            |
| 302 | 2025-06-17 | Verizon                |  -94.99 | 5205 Utilities Expense               |            |
| 303 | 2025-06-18 | Hank's Place           |  -43.59 | 5217 Meals and Entertainment Expense |            |
| 316 | 2025-06-26 | Giant                  |  -63.01 | 5216 Travel Expense                  |            |
| 317 | 2025-06-27 | Southwest              | -436.96 | 5216 Travel Expense                  |            |
| 323 | 2025-06-30 | Hilton                 | -406.24 | 5216 Travel Expense                  |            |
| 328 | 2025-07-01 | Google                 |   -8.90 | 5214 Software Expense                |            |
| 352 | 2025-07-15 | Verizon                |  -94.99 | 5205 Utilities Expense               |            |
| 387 | 2025-08-01 | Google                 |   -8.90 | 5214 Software Expense                |            |
| 390 | 2025-08-01 | Southwest              | -388.00 | 5216 Travel Expense                  |            |
| 402 | 2025-08-08 | BWI Daily Garage       |  -48.00 | 5216 Travel Expense                  |            |
| 419 | 2025-08-14 | Verizon                |  -94.99 | 5205 Utilities Expense               |            |
| 420 | 2025-08-15 | Talula's               |  -15.37 | 5217 Meals and Entertainment Expense |            |
| 435 | 2025-08-29 | Country Butcher        |  -18.93 | 5217 Meals and Entertainment Expense |            |
| 441 | 2025-09-02 | Google                 |   -8.90 | 5214 Software Expense                |            |
| 453 | 2025-09-12 | Lowes                  |  -96.25 | 5206 Repairs and Maintenance Expense |            |
| 454 | 2025-09-16 | La Verona              |  -29.51 | 5217 Meals and Entertainment Expense |            |
| 456 | 2025-09-16 | Verizon                |  -94.99 | 5205 Utilities Expense               |            |
| 458 | 2025-09-17 | Oxford Feed & Lumber   |  -41.93 | 5206 Repairs and Maintenance Expense |            |
| 459 | 2025-09-17 | Talula's               |  -13.64 | 5217 Meals and Entertainment Expense |            |
| 460 | 2025-09-17 | Lowes                  | -327.80 | 5206 Repairs and Maintenance Expense |            |
| 479 | 2025-09-24 | Lowes                  |  -98.17 | 5206 Repairs and Maintenance Expense |            |
| 488 | 2025-09-26 | Lowes                  |  -50.31 | 5206 Repairs and Maintenance Expense |            |
| 493 | 2025-09-30 | Sherwin Williams       |  -92.58 | 5206 Repairs and Maintenance Expense |            |
| 496 | 2025-09-30 | Lowes                  | -268.01 | 5206 Repairs and Maintenance Expense |            |
| 499 | 2025-09-30 | Sherwin Williams       | -236.67 | 5206 Repairs and Maintenance Expense |            |
| 507 | 2025-10-01 | PECO                   | -120.04 | 5205 Utilities Expense               |            |
| 509 | 2025-10-01 | Google                 |   -8.90 | 5214 Software Expense                |            |
| 510 | 2025-10-01 | Lowes                  | -180.84 | 5206 Repairs and Maintenance Expense |            |
| 513 | 2025-10-02 | Stoner Decorating      |  -45.87 | 5206 Repairs and Maintenance Expense |            |
| 556 | 2025-10-14 | Sherwin Williams       |  -47.65 | 5206 Repairs and Maintenance Expense |            |
| 563 | 2025-10-14 | Lowes                  |  -95.98 | 5206 Repairs and Maintenance Expense |            |
| 564 | 2025-10-14 | Stoner Decorating      |  -42.39 | 5206 Repairs and Maintenance Expense |            |
| 572 | 2025-10-15 | Verizon                |  -94.99 | 5205 Utilities Expense               |            |
| 578 | 2025-10-16 | Lowes                  |  -52.96 | 5206 Repairs and Maintenance Expense |            |
| 579 | 2025-10-16 | Lowes                  | -274.93 | 5206 Repairs and Maintenance Expense |            |
| 583 | 2025-10-17 | Home Depot             | -177.80 | 5206 Repairs and Maintenance Expense |            |
| 589 | 2025-10-20 | Home Depot             | -173.98 | 5206 Repairs and Maintenance Expense |            |
| 598 | 2025-10-22 | Cameron's Hardware     |   -8.86 | 5206 Repairs and Maintenance Expense |            |
| 607 | 2025-10-23 | Lowes                  | -109.52 | 5206 Repairs and Maintenance Expense |            |
| 634 | 2025-10-31 | PECO                   | -134.86 | 5205 Utilities Expense               |            |
| 640 | 2025-11-03 | Cameron's Hardware     |   -8.47 | 5206 Repairs and Maintenance Expense |            |
| 653 | 2025-11-05 | Lowes                  |  -83.28 | 5206 Repairs and Maintenance Expense |            |
| 654 | 2025-11-05 | Lowes                  | -211.16 | 5206 Repairs and Maintenance Expense |            |
| 671 | 2025-11-10 | Marriott               |  -71.95 | 5216 Travel Expense                  |            |
| 674 | 2025-11-10 | Fairfield Inn & Suites |  -12.84 | 5216 Travel Expense                  |            |
| 681 | 2025-11-12 | Lowes                  | -284.42 | 5206 Repairs and Maintenance Expense |            |
| 685 | 2025-11-14 | Verizon                |  -94.99 | 5205 Utilities Expense               |            |
| 686 | 2025-11-14 | Stoner Decorating      |  -30.90 | 5215 Supplies Expense                |            |
| 688 | 2025-11-14 | Sherwin Williams       | -136.58 | 5206 Repairs and Maintenance Expense |            |
| 690 | 2025-11-14 | Sherwin Williams       |  -44.47 | 5206 Repairs and Maintenance Expense |            |
| 694 | 2025-11-17 | Lowes                  |  -19.06 | 5206 Repairs and Maintenance Expense |            |
| 701 | 2025-11-19 | Lowes                  |  -52.96 | 5206 Repairs and Maintenance Expense |            |
| 702 | 2025-11-19 | Lowes                  | -317.06 | 5206 Repairs and Maintenance Expense |            |
| 703 | 2025-11-19 | Lowes                  |  -79.84 | 5206 Repairs and Maintenance Expense |            |
| 706 | 2025-11-20 | Lowes                  |   70.28 | 5206 Repairs and Maintenance Expense |            |
| 713 | 2025-11-21 | Lowes                  | -685.74 | 5206 Repairs and Maintenance Expense |            |
| 719 | 2025-11-24 | Lowes                  |  -26.48 | 5206 Repairs and Maintenance Expense |            |
| 722 | 2025-11-25 | Lowes                  | -794.37 | 5206 Repairs and Maintenance Expense |            |
| 723 | 2025-11-25 | Stoner Decorating      |  -36.03 | 5206 Repairs and Maintenance Expense |            |
| 724 | 2025-11-26 | Lowes                  |   52.96 | 5206 Repairs and Maintenance Expense |            |
| 725 | 2025-11-26 | Lowes                  |  -38.04 | 5206 Repairs and Maintenance Expense |            |
| 738 | 2025-12-02 | PECO                   | -113.03 | 5205 Utilities Expense               |            |
| 750 | 2025-12-04 | Borough of Kennett     |   -1.56 | 5216 Travel Expense                  |            |
| 757 | 2025-12-05 | Sherwin Williams       | -310.73 | 5206 Repairs and Maintenance Expense |            |
| 779 | 2025-12-16 | Verizon                |  -94.99 | 5205 Utilities Expense               |            |
| 806 | 2025-12-30 | PECO                   | -139.37 | 5205 Utilities Expense               |            |

Other cross-entity rows (also bridged):

|   # | Date       | Vendor               |  Amount | Account                              | Class      | Bank  |
| --: | ---------- | -------------------- | ------: | ------------------------------------ | ---------- | ----- |
| 818 | 2025-01-18 | Allan Hill - Plumber | -200.00 | 5206 Repairs and Maintenance Expense | Providence | Venmo |
| 843 | 2025-10-15 | Nick Laganelli       | -650.00 | 5206 Repairs and Maintenance Expense | Providence | Venmo |
| 850 | 2025-12-15 | Raul Snow Plower     | -225.00 | 5208 Snow Removal Expense            | Providence | Venmo |

The 9 General-class rows on the PLA bank need no bridge (General takes the bank's entity):

|   # | Date       | Vendor               |  Amount | Account                   |
| --: | ---------- | -------------------- | ------: | ------------------------- |
| 455 | 2025-09-16 | Walmart              | -378.42 | 3102 Capital Distribution |
| 575 | 2025-10-15 | Amazon               |  -37.05 | 3102 Capital Distribution |
| 576 | 2025-10-15 | Mr Wizard Car Wash   |  -20.00 | 3102 Capital Distribution |
| 581 | 2025-10-16 | Amazon               |  -97.25 | 3102 Capital Distribution |
| 582 | 2025-10-16 | Amazon               |  -42.22 | 3102 Capital Distribution |
| 611 | 2025-10-24 | CVS                  |   -6.67 | 5215 Supplies Expense     |
| 620 | 2025-10-27 | Acme                 |  -12.99 | 3102 Capital Distribution |
| 729 | 2025-11-28 | Krishna              |  -37.13 | 3102 Capital Distribution |
| 780 | 2025-12-16 | Oxford Feed & Lumber |   -4.23 | 3102 Capital Distribution |

## Reference allocation models (2020–2024 Tax Worksheets)

Archived, read-only, never applied. Each percentage set of a worksheet is one model with one version; every number was re-checked against the worksheet cell it came from.

### 2020 — `2020 Tax Worksheet`

In 2020 Jose split the shared costs of the Chisel Creek property four ways: The Shed, The Club House, The Land to Develop and Our House (his personal home). He first assigned a value to each: the Shed (225,000) and the Clubhouse (375,000) were typed in, and the remaining 500,000 of the 1,100,000 whole-property value was spread over the Land and the House using 5 buildable lots at 75,000 each plus a per-acre rate of about 1,288.66 on 97 acres, which gives the Land (4 lots, 39 acres) 350,257.73 and the House (1 lot, 58 acres) 149,742.27. Two percentage sets come out of that table. '% of Land Expenses' is by acres (Shed 2.0%, Clubhouse 9.2%, Land 35.7%, House 53.1%) and is meant for costs that relate to the ground itself. '% of Other Expenses' is by value (Shed 20.5%, Clubhouse 34.1%, Land 31.8%, House 13.6%) and is meant for everything else shared. A third set, 'Expenses with no Shed', leaves the Shed out and uses value shares rounded to whole percents (Clubhouse 43%, Land 40%, House 17%) for costs that do not touch the Shed. The House share in every set is Jose's personal portion and goes to 3102 Capital Distribution rather than to an expense account. This year's tab does not list individual bills or a reallocation table; the percentages were applied directly when the 2020 ledger lines were split, so nothing here is re-applied by the app. The tab also carries a breakdown of the 39 acres of developable land and a later '2022 Assessment' note that splits the parcel's tax assessment into personal and business portions (land by the house's acre share, buildings by original vs added assessment) at a 3.41% tax rate.

Verified against the workbook: 60 cell-addressed numbers checked, 0 mismatches; the transcription accounts for 97 of the sheet's 97 non-empty cells.

**2020 · % of Land Expenses** (ACRES) — All four Chisel Creek properties (Shed, Clubhouse, Land to Develop, Our House) weighted by acres (C5:C8, total 109.2 ac in C9).

| Target              | Ledger class                        | Weight |     Share |     Basis points |
| ------------------- | ----------------------------------- | -----: | --------: | ---------------: |
| The Shed            | Rentals:The Shed                    |    2.2 |  2.0147 % |              201 |
| The Club House      | Rentals:The Clubhouse               |     10 |  9.1575 % |              916 |
| The Land to Develop | Land Development:13 Chisel Creek Dr |     39 | 35.7143 % |             3571 |
| Our House           | _Personal (3102)_                   |     58 | 53.1136 % | 5312 (remainder) |

**2020 · % of Other Expenses** (VALUE) — All four Chisel Creek properties weighted by Total Value (E5:E8, total 1,100,000 in E9); the house share I8 is written as 1 - SUM(I5:I7) so the column sums to exactly 1.

| Target              | Ledger class                        |      Weight |     Share |     Basis points |
| ------------------- | ----------------------------------- | ----------: | --------: | ---------------: |
| The Shed            | Rentals:The Shed                    |     225,000 | 20.4545 % |             2045 |
| The Club House      | Rentals:The Clubhouse               |     375,000 | 34.0909 % | 3410 (remainder) |
| The Land to Develop | Land Development:13 Chisel Creek Dr | 350,257.732 | 31.8416 % |             3184 |
| Our House           | _Personal (3102)_                   | 149,742.268 | 13.6129 % |             1361 |

**2020 · Expenses with no Shed** (PERCENT) — Clubhouse, Land to Develop and Our House only (Shed excluded), weighted by Total Value (E6:E8, total 875,000) and ROUNDED to whole percents by the sheet's formulas (J6:J8 = ROUND(E/SUM(E6:E8), 2)): 0.43 / 0.40 / 0.17. Stored as manual percentages because the rounded shares, not weight ÷ sum, are what the year used; the unrounded value shares would be 0.428571 / 0.400295 / 0.171134.

| Target              | Ledger class                        | Weight |     Share |     Basis points |
| ------------------- | ----------------------------------- | -----: | --------: | ---------------: |
| The Club House      | Rentals:The Clubhouse               |   0.43 | 43.0000 % | 4300 (remainder) |
| The Land to Develop | Land Development:13 Chisel Creek Dr |    0.4 | 40.0000 % |             4000 |
| Our House           | _Personal (3102)_                   |   0.17 | 17.0000 % |             1700 |

### 2021 — `2021 Tax Worksheet`

For 2021 Jose valued the whole 13 Chisel Creek property at $1,100,000 and assigned $225,000 of it to The Shed and $375,000 to The Clubhouse, leaving $500,000 for the raw land. That $500,000 was explained as 5 buildable lots at $75,000 each ($375,000) plus the remaining 92 acres at a back-solved $1,358.70 per acre ($125,000). Each piece of the property (Shed, Clubhouse, the Land to Develop, and Jose's own house) was given a lot count and an acreage (2.2 / 15 / 72 / 20 acres, 109.2 in all), and the values of the developable land ($397,826) and the house ($102,174) fall out of those lot and acre prices. From this the sheet builds five percentage columns. '% of Land Expenses' splits by acres (Shed 2.0%, Clubhouse 13.7%, Land 65.9%, House 18.3%) and is meant for ground costs such as mowing. '% of Other Expenses' splits by value (20.5% / 34.1% / 36.2% / 9.3%) for costs like insurance that follow what the buildings are worth. 'Expenses with no Shed' is the same value split over just the Clubhouse, the Land and the House, rounded to whole percents (43% / 45% / 12%). 'Expenses with all' spreads a cost across all seven properties by value, bringing in the three rentals owned by then (142 Maloney $258,250, 176 Tulsk $285,000, 544 Liberty $284,000), rounded to whole percents (12/19/21/5/13/15/15). 'Expenses with no personal house' does the same over the six business properties only, unrounded. In every set the 'Our House' share is Jose's personal share, which the books record as a capital distribution (3102), not as a business expense. This sheet does not itself allocate any specific bill; the percentages were applied when the 2021 entries were split in the ledger. The rest of the tab is reference material: cost-basis breakdowns (building / land / fixtures) for the Clubhouse, the Shed and 142 Maloney, the closing statements and cost-basis breakdowns for the two 2021 purchases (176 Tulsk and 544 Liberty), and a 'readjusted' copy of the acreage table (Land 62 acres / House 30 acres) with a 2022 reassessment of the 1625 parcel split personal-vs-business, which a note says should be used for 2022.

Verified against the workbook: 142 cell-addressed numbers checked, 0 mismatches; the transcription accounts for 394 of the sheet's 394 non-empty cells.

**2021 · % of Land Expenses** (ACRES) — Shed, Clubhouse, Land to Develop and Our House weighted by acres (C6:C9); for ground-related costs such as mowing.

| Target              | Ledger class                        | Weight |     Share |     Basis points |
| ------------------- | ----------------------------------- | -----: | --------: | ---------------: |
| The Shed            | Rentals:The Shed                    |    2.2 |  2.0147 % |              201 |
| The Club House      | Rentals:The Clubhouse               |     15 | 13.7363 % |             1374 |
| The Land to Develop | Land Development:13 Chisel Creek Dr |     72 | 65.9341 % | 6593 (remainder) |
| Our House           | _Personal (3102)_                   |     20 | 18.3150 % |             1832 |

**2021 · % of Other Expenses** (VALUE) — Shed, Clubhouse, Land to Develop and Our House weighted by assigned total value (E6:E9 over E10 = 1,100,000); I9 is written as 1 - SUM(I6:I8) but equals E9/E10.

| Target              | Ledger class                        |      Weight |     Share |     Basis points |
| ------------------- | ----------------------------------- | ----------: | --------: | ---------------: |
| The Shed            | Rentals:The Shed                    |     225,000 | 20.4545 % |             2045 |
| The Club House      | Rentals:The Clubhouse               |     375,000 | 34.0909 % |             3409 |
| The Land to Develop | Land Development:13 Chisel Creek Dr | 397,826.087 | 36.1660 % | 3617 (remainder) |
| Our House           | _Personal (3102)_                   | 102,173.913 |  9.2885 % |              929 |

**2021 · Expenses with no Shed** (PERCENT) — Keyed as PERCENT because the sheet ROUNDS these shares to whole percents (ROUND(E/SUM($E$7:$E$9),2)), so share is not exactly value/sum; the underlying value weights are kept in valueWeight/valueWeightCell. Clubhouse, Land to Develop and Our House weighted by value (E7:E9 over their sum 875,000), ROUNDED to whole percents by the sheet (ROUND(E/SUM(E7:E9),2)); exact unrounded shares would be 0.428571 / 0.454658 / 0.116770.

| Target              | Ledger class                        | Weight |     Share |     Basis points |
| ------------------- | ----------------------------------- | -----: | --------: | ---------------: |
| The Club House      | Rentals:The Clubhouse               |   0.43 | 43.0000 % |             4300 |
| The Land to Develop | Land Development:13 Chisel Creek Dr |   0.45 | 45.0000 % | 4500 (remainder) |
| Our House           | _Personal (3102)_                   |   0.12 | 12.0000 % |             1200 |

**2021 · Expenses with all** (PERCENT) — Keyed as PERCENT because the sheet ROUNDS these shares to whole percents (ROUND(E/$E$15,2)), so share is not exactly value/sum; the underlying value weights are kept in valueWeight/valueWeightCell. All seven properties weighted by value (E6:E9 and E12:E14 over E15 = 1,927,250), ROUNDED to whole percents by the sheet (ROUND(E/E15,2)); the rounded column happens to sum to exactly 1.00.

| Target              | Ledger class                        | Weight |     Share |     Basis points |
| ------------------- | ----------------------------------- | -----: | --------: | ---------------: |
| The Shed            | Rentals:The Shed                    |   0.12 | 12.0000 % |             1200 |
| The Club House      | Rentals:The Clubhouse               |   0.19 | 19.0000 % |             1900 |
| The Land to Develop | Land Development:13 Chisel Creek Dr |   0.21 | 21.0000 % | 2100 (remainder) |
| Our House           | _Personal (3102)_                   |   0.05 |  5.0000 % |              500 |
| 142 Maloney         | Rentals:142 Maloney Terrace         |   0.13 | 13.0000 % |             1300 |
| 176 Tulsk           | Rentals:176 Tulsk Road              |   0.15 | 15.0000 % |             1500 |
| 544 Liberty         | Rentals:544 Liberty Circle          |   0.15 | 15.0000 % |             1500 |

**2021 · Expenses with no personal house** (VALUE) — The six business properties (Shed, Clubhouse, Land to Develop, 142 Maloney, 176 Tulsk, 544 Liberty) weighted by value; Our House excluded. Unrounded.

| Target              | Ledger class                        |      Weight |     Share |     Basis points |
| ------------------- | ----------------------------------- | ----------: | --------: | ---------------: |
| The Shed            | Rentals:The Shed                    |     225,000 | 12.3283 % |             1233 |
| The Club House      | Rentals:The Clubhouse               |     375,000 | 20.5471 % |             2055 |
| The Land to Develop | Land Development:13 Chisel Creek Dr | 397,826.087 | 21.7978 % | 2179 (remainder) |
| 142 Maloney         | Rentals:142 Maloney Terrace         |     258,250 | 14.1501 % |             1415 |
| 176 Tulsk           | Rentals:176 Tulsk Road              |     285,000 | 15.6158 % |             1562 |
| 544 Liberty         | Rentals:544 Liberty Circle          |     284,000 | 15.5610 % |             1556 |

**2021 · % of Land Expenses (readjusted for 2022)** (ACRES) — Readjusted-for-2022 copy of pct_land_expenses (same header text as H5, in the second table headed by note N15) using the corrected acreages in O18:O21 (Land to Develop 62 ac, Our House 30 ac instead of 72 / 20). Note N15 says this table is what should be used for 2022.

| Target              | Ledger class                        | Weight |     Share |     Basis points |
| ------------------- | ----------------------------------- | -----: | --------: | ---------------: |
| The Shed            | Rentals:The Shed                    |    2.2 |  2.0147 % |              201 |
| The Club House      | Rentals:The Clubhouse               |     15 | 13.7363 % |             1374 |
| The Land to Develop | Land Development:13 Chisel Creek Dr |     62 | 56.7766 % | 5678 (remainder) |
| Our House           | _Personal (3102)_                   |     30 | 27.4725 % |             2747 |

**2021 · % of Other Expenses (readjusted for 2022)** (PERCENT) — Keyed as PERCENT because the sheet's shares are not value/sum of this table: U18:U20 = Q/$E$10 (denominator 1,100,000 from the ORIGINAL table) and U21 = 1 - SUM(U18:U20); the table's own Q values (two of them 0) are kept in valueWeight/valueWeightCell. Readjusted-for-2022 copy of pct_other_expenses (same header text as I5, in the second table headed by note N15). The sheet divides Q18:Q20 by the ORIGINAL total E10 = 1,100,000 and plugs Our House as 1 - SUM(U18:U20). Because Q20 and Q21 are 0 (their formulas point at empty per-lot / per-acre cells O14:O15), the Land to Develop gets 0% and Our House absorbs 45.45% (implied weight 500,000 = 1,100,000 - 225,000 - 375,000). share != weight / sum(weights) for this set; it is a half-updated table, transcribed as-is.

| Target              | Ledger class                        | Weight |     Share |     Basis points |
| ------------------- | ----------------------------------- | -----: | --------: | ---------------: |
| The Shed            | Rentals:The Shed                    |  0.205 | 20.4545 % |             2045 |
| The Club House      | Rentals:The Clubhouse               |  0.341 | 34.0909 % |             3409 |
| The Land to Develop | Land Development:13 Chisel Creek Dr |      0 |  0.0000 % |                0 |
| Our House           | _Personal (3102)_                   |  0.455 | 45.4545 % | 4546 (remainder) |

**2021 · Value of our House / Value of Club House** (VALUE) — Building-value split between Jose's house (1,500,000) and the Clubhouse (500,000) used to divide the reassessed 1625 buildings between personal and business.

| Target              | Ledger class          |    Weight |     Share |     Basis points |
| ------------------- | --------------------- | --------: | --------: | ---------------: |
| Value of our House  | _Personal (3102)_     | 1,500,000 | 75.0000 % | 7500 (remainder) |
| Value of Club House | Rentals:The Clubhouse |   500,000 | 25.0000 % |             2500 |

### 2022 — `2022 Tax Worksheet`

In 2022 Jose valued the four pieces of the 13 Chisel Creek property (the Shed 300,000, the Clubhouse 550,000, the developable land 2,237,600 - ten buildable lots at 100,000 plus 72.8 acres at 17,000 - and his own house 1,200,000) and turned those values into four percentage sets: all four together, without the Shed, without the house, and without either. The 'no Shed' set gives the personal share of the 1625 parcel (the house is 30.09%), so 69.91% of every township, county and Avon Grove school tax bill on that parcel, including the three interim bills for the new construction, and 69.91% of its insurance is business; the rest is Jose's personal expense. The business part of each tax is then divided between the developable land (80.27%) and the Clubhouse (19.73%) using the 'no shed/house' set, and the business part of the insurance is divided among the Shed, the land and the Clubhouse using the 'no house' set. The four ordinary rentals (176 Tulsk, 142 Maloney, 544 Liberty and the Shed's own tax parcel) keep 100% of their own tax and insurance bills. 533 Mystic, rented to the Bolmers from Feb 25 to Jul 31, counts only 157/365 = 43.01% of its bills as business. A fifth set weights every property (including the rentals) by market value times months in service, with 533 Mystic at 5 months; it splits the umbrella insurance premium (1,015.22) across all seven properties. Finally, the General-class expense totals for the year are reallocated to properties: landscaping, utilities, repairs, trash, snow removal and cleaning go to the land, the Clubhouse and the Shed by the 'no house' shares (rounding remainder to the Shed), while professional fees, bank fees, postage, software, supplies, travel, meals and donations go to all seven properties by the value-times-months shares (remainder to 533 Mystic). The sheet also carries the 2022 county assessment math for the parcel (assessment 968,990 after the 758,860 building addition, common level ratio 0.395, tax rate 3.41%) for reference only.

Verified against the workbook: 205 cell-addressed numbers checked, 0 mismatches; the transcription accounts for 560 of the sheet's 560 non-empty cells.

**2022 · % (all)** (VALUE) — Shed, Clubhouse, developable land and Jose's house, weighted by assigned value (D18:D21); Our House share computed as 1 minus the others (E21).

| Target         | Ledger class                        |    Weight |     Share |     Basis points |
| -------------- | ----------------------------------- | --------: | --------: | ---------------: |
| The Shed       | Rentals:The Shed                    |   300,000 |  6.9969 % |              700 |
| The Club House | Rentals:The Clubhouse               |   550,000 | 12.8277 % |             1283 |
| The Land       | Land Development:13 Chisel Creek Dr | 2,237,600 | 52.1877 % | 5218 (remainder) |
| Our House      | _Personal (3102)_                   | 1,200,000 | 27.9877 % |             2799 |

**2022 · % (no Shed)** (VALUE) — Clubhouse, developable land and Jose's house (the three things on the 1625 parcel), weighted by value; used to find how much of the parcel is personal.

| Target         | Ledger class                        |    Weight |     Share |     Basis points |
| -------------- | ----------------------------------- | --------: | --------: | ---------------: |
| The Club House | Rentals:The Clubhouse               |   550,000 | 13.7928 % |             1379 |
| The Land       | Land Development:13 Chisel Creek Dr | 2,237,600 | 56.1140 % | 5612 (remainder) |
| Our House      | _Personal (3102)_                   | 1,200,000 | 30.0933 % |             3009 |

**2022 · % (no house)** (VALUE) — Shed, Clubhouse and developable land (all business things on 13 Chisel Creek), weighted by value.

| Target         | Ledger class                        |    Weight |     Share |     Basis points |
| -------------- | ----------------------------------- | --------: | --------: | ---------------: |
| The Shed       | Rentals:The Shed                    |   300,000 |  9.7163 % |              972 |
| The Club House | Rentals:The Clubhouse               |   550,000 | 17.8132 % |             1781 |
| The Land       | Land Development:13 Chisel Creek Dr | 2,237,600 | 72.4705 % | 7247 (remainder) |

**2022 · % (no shed/house)** (VALUE) — Clubhouse and developable land only, weighted by value; used for the 1625 parcel property taxes (the Shed is a separate tax parcel).

| Target         | Ledger class                        |    Weight |     Share |     Basis points |
| -------------- | ----------------------------------- | --------: | --------: | ---------------: |
| The Club House | Rentals:The Clubhouse               |   550,000 | 19.7302 % |             1973 |
| The Land       | Land Development:13 Chisel Creek Dr | 2,237,600 | 80.2698 % | 8027 (remainder) |

**2022 · Percent (market value x months)** (VALUE × MONTHS) — Every property including the rentals, weighted by market value times months in service in 2022 (533 Mystic 5 months, all others 12).

| Target        | Ledger class                        |         Weight |     Share |     Basis points |
| ------------- | ----------------------------------- | -------------: | --------: | ---------------: |
| 533 Mystic    | Rentals:533 Mystic Lane             |    475,000 × 5 |  4.6291 % |              463 |
| The Land      | Land Development:13 Chisel Creek Dr | 2,237,600 × 12 | 52.3352 % | 5233 (remainder) |
| The Clubhouse | Rentals:The Clubhouse               |   550,000 × 12 | 12.8639 % |             1286 |
| The Shed      | Rentals:The Shed                    |   300,000 × 12 |  7.0167 % |              702 |
| 176 Tulsk     | Rentals:176 Tulsk Road              |   330,000 × 12 |  7.7184 % |              772 |
| 142 Maloney   | Rentals:142 Maloney Terrace         |   330,000 × 12 |  7.7184 % |              772 |
| 544 Liberty   | Rentals:544 Liberty Circle          |   330,000 × 12 |  7.7184 % |              772 |

Specific bills allocated: Township tax on the 1625 parcel (regular + interim), business share 1,665.41 (`pct_no_shed_house`); Chester County tax on the 1625 parcel (regular + interim), business share 3,036.93 (`pct_no_shed_house`); Avon Grove School tax on the 1625 parcel (regular + interim), business share 31,350.25 (`pct_no_shed_house`); 13 Chisel Creek insurance, business share 1,041.67 (`pct_no_house`); Umbrella insurance 1,015.22 (`pct_all_months`).

### 2023 — `2023 Tax Worksheet`

In 2023 Jose gave every property an assigned market value and used those values as the weights for all splits (acres are listed for the Chisel Creek pieces but are not used as weights). The developable land at 13 Chisel Creek was valued at 2,142,000: 10 buildable lots at 120,000 each plus 62.8 acres at 15,000 per acre. The other values were 350,000 for 1671-1675 New London Rd, 300,000 for The Shed, 500,000 for The Clubhouse, 1,250,000 for Jose's house, and 360,000 each for 176 Tulsk, 142 Maloney and 544 Liberty. Five percentage sets come from those values. '% (all)' spreads the 1,335.00 umbrella insurance over all eight properties including the house. '% Just Chisel Creek Land' spreads the 2,619.00 Chisel Creek insurance over the Shed, the Clubhouse, the land and the house. '% Just 1625' spreads the Franklin Township (2,417.63), Chester County (4,850.86) and Avon Grove School District (33,188.88) taxes on the 1625 parcel over the Clubhouse, the land and the house. In each of those bills the Our House share is Jose's personal expense and goes to 3102 Capital Distribution, not to an expense account. A separate 'Reallocation of General Expenses' block then spreads each expense account's General-class total for the year across the business properties only: Landscaping and Repairs & Maintenance are split four ways over 1671-1675, the Shed, the Clubhouse and the land ('% Just Chisel Creek Properties'), while the remaining eleven accounts are split seven ways over every property except the house (the set labelled '% All' on row 22, which excludes the house). A list of Shed rent receipts by payer at the bottom of the sheet is documentation only.

Verified against the workbook: 198 cell-addressed numbers checked, 0 mismatches; the transcription accounts for 301 of the sheet's 301 non-empty cells.

**2023 · % (all)** (VALUE) — Share of assigned value across all eight properties including Jose's house (total value D19 = 5,622,000).

| Target               | Ledger class                             |    Weight |     Share |     Basis points |
| -------------------- | ---------------------------------------- | --------: | --------: | ---------------: |
| 1621-1675            | Land Development:1671-1675 New London Rd |   350,000 |  6.2255 % |              623 |
| The Shed             | Rentals:The Shed                         |   300,000 |  5.3362 % |              534 |
| The Club House       | Rentals:The Clubhouse                    |   500,000 |  8.8936 % |              889 |
| 13 Chisel Creek Land | Land Development:13 Chisel Creek Dr      | 2,142,000 | 38.1003 % | 3811 (remainder) |
| Our House            | _Personal (3102)_                        | 1,250,000 | 22.2341 % |             2223 |
| 176 Tulsk            | Rentals:176 Tulsk Road                   |   360,000 |  6.4034 % |              640 |
| 142 Maloney          | Rentals:142 Maloney Terrace              |   360,000 |  6.4034 % |              640 |
| 544 Liberty          | Rentals:544 Liberty Circle               |   360,000 |  6.4034 % |              640 |

**2023 · % Just Chisel Creek Land** (VALUE) — Share of assigned value across the four pieces of the Chisel Creek property: The Shed, The Clubhouse, the developable land and Jose's house (total 4,192,000).

| Target               | Ledger class                        |    Weight |     Share |     Basis points |
| -------------------- | ----------------------------------- | --------: | --------: | ---------------: |
| The Shed             | Rentals:The Shed                    |   300,000 |  7.1565 % |              716 |
| The Club House       | Rentals:The Clubhouse               |   500,000 | 11.9275 % |             1193 |
| 13 Chisel Creek Land | Land Development:13 Chisel Creek Dr | 2,142,000 | 51.0973 % | 5109 (remainder) |
| Our House            | _Personal (3102)_                   | 1,250,000 | 29.8187 % |             2982 |

**2023 · % Just 1625** (VALUE) — Share of assigned value across the three pieces on the 1625 tax parcel: The Clubhouse, the developable land and Jose's house (total 3,892,000).

| Target               | Ledger class                        |    Weight |     Share |     Basis points |
| -------------------- | ----------------------------------- | --------: | --------: | ---------------: |
| The Club House       | Rentals:The Clubhouse               |   500,000 | 12.8469 % |             1285 |
| 13 Chisel Creek Land | Land Development:13 Chisel Creek Dr | 2,142,000 | 55.0360 % | 5503 (remainder) |
| Our House            | _Personal (3102)_                   | 1,250,000 | 32.1172 % |             3212 |

**2023 · % Just Chisel Creek Properties** (VALUE) — Share of assigned value across the four business pieces of Chisel Creek / New London Rd: 1671-1675, The Shed, The Clubhouse and the developable land (no house, no other rentals; total 3,292,000). The weights are the assigned values repeated in row 23 (labelled 'Value' in C23).

| Target               | Ledger class                             |    Weight |     Share |     Basis points |
| -------------------- | ---------------------------------------- | --------: | --------: | ---------------: |
| 1671-1675            | Land Development:1671-1675 New London Rd |   350,000 | 10.6318 % |             1063 |
| The Shed             | Rentals:The Shed                         |   300,000 |  9.1130 % |              911 |
| The Clubhouse        | Rentals:The Clubhouse                    |   500,000 | 15.1883 % |             1519 |
| 13 Chisel Creek Land | Land Development:13 Chisel Creek Dr      | 2,142,000 | 65.0668 % | 6507 (remainder) |

**2023 · % All (no house)** (VALUE) — Share of assigned value across the seven business properties, i.e. every property except Jose's house (total 4,372,000). The sheet labels it '% All'. The weights are the assigned values repeated in row 23 (labelled 'Value' in C23).

| Target               | Ledger class                             |    Weight |     Share |     Basis points |
| -------------------- | ---------------------------------------- | --------: | --------: | ---------------: |
| 1671-1675            | Land Development:1671-1675 New London Rd |   350,000 |  8.0055 % |              801 |
| The Shed             | Rentals:The Shed                         |   300,000 |  6.8618 % |              686 |
| The Clubhouse        | Rentals:The Clubhouse                    |   500,000 | 11.4364 % |             1144 |
| 13 Chisel Creek Land | Land Development:13 Chisel Creek Dr      | 2,142,000 | 48.9936 % | 4900 (remainder) |
| 176 Tulsk            | Rentals:176 Tulsk Road                   |   360,000 |  8.2342 % |              823 |
| 142 Maloney          | Rentals:142 Maloney Terrace              |   360,000 |  8.2342 % |              823 |
| 544 Liberty          | Rentals:544 Liberty Circle               |   360,000 |  8.2342 % |              823 |

Specific bills allocated: Umbrella (All) Total 1,335.00 (`pct_all`); Insurance CC Total 2,619.00 (`pct_chisel_creek_land`); Franklin Twnshp Tax 1625 2,417.63 (`pct_just_1625`); Chester County Tax 1625 4,850.86 (`pct_just_1625`); AG School District Tax 1625 33,188.88 (`pct_just_1625`).

### 2024 — `2024 Tax Worksheet`

Jose gave every property an assigned market value and (for the Chisel Creek parcel) an acreage: 1671-1675 New London Rd 5.6 acres / 350,000; The Shed 2.2 acres / 300,000; The Clubhouse 15 acres / 500,000; the developable 13 Chisel Creek land 67.8 acres (the parcel's 115 acres less the Shed, the Clubhouse and Our House) valued at 1,878,000 (10 buildable lots at 120,000 plus 67.8 acres at 10,000); Our House 30 acres / 1,300,000; and 176 Tulsk, 142 Maloney, 544 Liberty and 136 Sunnyside at 380,000 each. All percentages are value shares - the acreage version (row 24) was computed but not used. The umbrella insurance bill (1,392.32) was split by value across every property except 136 Sunnyside, which was bought during the year and not on the policy; the column E '% (all)' figures, which include Sunnyside, were not the ones actually applied. The Chisel Creek property insurance (2,619.00) was split by value across only The Shed, The Clubhouse, the developable land and Our House. The three taxes on parcel 1625 (Franklin Township 2,659.39, Chester County 4,850.86, Avon Grove School District 33,188.88) were split by value across only The Clubhouse, the developable land and Our House. Both insurance bills are marked 'paid for personally', meaning Jose paid them from his own money, so the business shares came in as capital contributions. Our House's share of every bill (about 22-35 percent depending on the set) is Jose's personal expense and goes to 3102 Capital Distribution rather than to an expense account. Separately, the 'Reallocation of General Expenses' table takes each expense account's General-class total for 2024 and spreads it to the properties: landscaping and repairs go only to the four Chisel Creek / New London Rd business properties (by value), while trash, cleaning, professional fees, bank fees, postage, software, supplies, travel and training go to all eight business properties (by value, Our House excluded). That table moved 93,338.49 out of General in total. The rest of the tab is documentation: a list of Shed rental payments by payer, the Clubhouse rent calculation, and the closing statement and purchase-price breakdown for 136 Sunnyside Road.

Verified against the workbook: 203 cell-addressed numbers checked, 0 mismatches; the transcription accounts for 429 of the sheet's 429 non-empty cells.

**2024 · % (all)** (VALUE) — Every property including Our House, weighted by assigned value (column D, total 5,848,000). Column E. Not actually applied to any bill on this sheet: the umbrella column F uses a different base (see pct_all_no_sunnyside).

| Target               | Ledger class                             |    Weight |     Share |     Basis points |
| -------------------- | ---------------------------------------- | --------: | --------: | ---------------: |
| 1621-1675            | Land Development:1671-1675 New London Rd |   350,000 |  5.9850 % |              599 |
| The Shed             | Rentals:The Shed                         |   300,000 |  5.1300 % |              513 |
| The Club House       | Rentals:The Clubhouse                    |   500,000 |  8.5499 % |              855 |
| 13 Chisel Creek Land | Land Development:13 Chisel Creek Dr      | 1,878,000 | 32.1135 % | 3210 (remainder) |
| Our House            | _Personal (3102)_                        | 1,300,000 | 22.2298 % |             2223 |
| 176 Tulsk            | Rentals:176 Tulsk Road                   |   380,000 |  6.4979 % |              650 |
| 142 Maloney          | Rentals:142 Maloney Terrace              |   380,000 |  6.4979 % |              650 |
| 544 Liberty          | Rentals:544 Liberty Circle               |   380,000 |  6.4979 % |              650 |
| 136 Sunnyside        | Rentals:136 Sunnyside                    |   380,000 |  6.4979 % |              650 |

**2024 · % (all) excluding 136 Sunnyside - implicit base of the umbrella column** (VALUE) — Value shares over the eight properties that had umbrella coverage (all except 136 Sunnyside; total 5,468,000). The sheet shows no percentage column for this - the shares are implied by the amounts in F11:F18 (e.g. F11 89.12 / 1,392.32 = 0.064008 = 350,000 / 5,468,000).

| Target               | Ledger class                             |    Weight |     Share |     Basis points |
| -------------------- | ---------------------------------------- | --------: | --------: | ---------------: |
| 1621-1675            | Land Development:1671-1675 New London Rd |   350,000 |  6.4009 % |              640 |
| The Shed             | Rentals:The Shed                         |   300,000 |  5.4865 % |              549 |
| The Club House       | Rentals:The Clubhouse                    |   500,000 |  9.1441 % |              914 |
| 13 Chisel Creek Land | Land Development:13 Chisel Creek Dr      | 1,878,000 | 34.3453 % | 3435 (remainder) |
| Our House            | _Personal (3102)_                        | 1,300,000 | 23.7747 % |             2377 |
| 176 Tulsk            | Rentals:176 Tulsk Road                   |   380,000 |  6.9495 % |              695 |
| 142 Maloney          | Rentals:142 Maloney Terrace              |   380,000 |  6.9495 % |              695 |
| 544 Liberty          | Rentals:544 Liberty Circle               |   380,000 |  6.9495 % |              695 |

**2024 · % Just Chisel Creek Land** (VALUE) — The four things on the 13 Chisel Creek parcel - The Shed, The Clubhouse, the developable land and Our House - weighted by value (total 3,978,000). Column G.

| Target               | Ledger class                        |    Weight |     Share |     Basis points |
| -------------------- | ----------------------------------- | --------: | --------: | ---------------: |
| The Shed             | Rentals:The Shed                    |   300,000 |  7.5415 % |              754 |
| The Club House       | Rentals:The Clubhouse               |   500,000 | 12.5691 % |             1257 |
| 13 Chisel Creek Land | Land Development:13 Chisel Creek Dr | 1,878,000 | 47.2097 % | 4721 (remainder) |
| Our House            | _Personal (3102)_                   | 1,300,000 | 32.6797 % |             3268 |

**2024 · % Just 1625** (VALUE) — Only what sits on tax parcel 1625: The Clubhouse, the developable land and Our House, weighted by value (total 3,678,000). Column I.

| Target               | Ledger class                        |    Weight |     Share |     Basis points |
| -------------------- | ----------------------------------- | --------: | --------: | ---------------: |
| The Club House       | Rentals:The Clubhouse               |   500,000 | 13.5943 % |             1359 |
| 13 Chisel Creek Land | Land Development:13 Chisel Creek Dr | 1,878,000 | 51.0604 % | 5106 (remainder) |
| Our House            | _Personal (3102)_                   | 1,300,000 | 35.3453 % |             3535 |

**2024 · % Just Chisel Creek Properties (on Value)** (VALUE) — The four business properties at Chisel Creek / New London Rd - 1671-1675, The Shed, The Clubhouse, 13 Chisel Creek Land - weighted by value (row 26, total 3,028,000). Our House is excluded. Row 23.

| Target               | Ledger class                             |    Weight |     Share |     Basis points |
| -------------------- | ---------------------------------------- | --------: | --------: | ---------------: |
| 1671-1675            | Land Development:1671-1675 New London Rd |   350,000 | 11.5588 % |             1156 |
| The Shed             | Rentals:The Shed                         |   300,000 |  9.9075 % |              991 |
| The Clubhouse        | Rentals:The Clubhouse                    |   500,000 | 16.5125 % |             1651 |
| 13 Chisel Creek Land | Land Development:13 Chisel Creek Dr      | 1,878,000 | 62.0211 % | 6202 (remainder) |

**2024 · % Just Chisel Creek Properties (on Acrage)** (ACRES) — Same four properties weighted by acres instead of value (row 27, total 90.6 acres). Row 24. Computed for comparison; not applied to any bill or account on this sheet.

| Target               | Ledger class                             | Weight |     Share |     Basis points |
| -------------------- | ---------------------------------------- | -----: | --------: | ---------------: |
| 1671-1675            | Land Development:1671-1675 New London Rd |    5.6 |  6.1810 % |              618 |
| The Shed             | Rentals:The Shed                         |    2.2 |  2.4283 % |              243 |
| The Clubhouse        | Rentals:The Clubhouse                    |     15 | 16.5563 % |             1656 |
| 13 Chisel Creek Land | Land Development:13 Chisel Creek Dr      |   67.8 | 74.8344 % | 7483 (remainder) |

**2024 · % All (row 25) - every business property, Our House excluded** (VALUE) — All eight business properties weighted by value (row 26, total 4,548,000); Our House is left out, so this differs from column E's % (all). Row 25.

| Target               | Ledger class                             |    Weight |     Share |     Basis points |
| -------------------- | ---------------------------------------- | --------: | --------: | ---------------: |
| 1671-1675            | Land Development:1671-1675 New London Rd |   350,000 |  7.6957 % |              770 |
| The Shed             | Rentals:The Shed                         |   300,000 |  6.5963 % |              660 |
| The Clubhouse        | Rentals:The Clubhouse                    |   500,000 | 10.9938 % |             1099 |
| 13 Chisel Creek Land | Land Development:13 Chisel Creek Dr      | 1,878,000 | 41.2929 % | 4127 (remainder) |
| 176 Tulsk            | Rentals:176 Tulsk Road                   |   380,000 |  8.3553 % |              836 |
| 142 Maloney          | Rentals:142 Maloney Terrace              |   380,000 |  8.3553 % |              836 |
| 544 Liberty          | Rentals:544 Liberty Circle               |   380,000 |  8.3553 % |              836 |
| 136 Sunnyside        | Rentals:136 Sunnyside                    |   380,000 |  8.3553 % |              836 |

Specific bills allocated: Umbrella (All) Total 1,392.32 (`pct_all_no_sunnyside`); Insurance CC Total 2,619.00 (`pct_just_chisel_creek_land`); Franklin Twnshp Tax 1625 2,659.39 (`pct_just_1625`); Chester County Tax 1625 4,850.86 (`pct_just_1625`); AG School District Tax 1625 33,188.88 (`pct_just_1625`).

#### Reference models — 44/44 ✅

All 44 cells match to the cent.

## Read back from the database

#### Database · 2019–2024 — 18/18 ✅

| Check                                                        |        Expected |          Actual |     |
| ------------------------------------------------------------ | --------------: | --------------: | :-: |
| Posted transactions                                          |           2,995 |           2,995 | ✅  |
| Voided placeholders (P0-3)                                   |               4 |               4 | ✅  |
| Drafts or flagged rows                                       |               0 |               0 | ✅  |
| Live lines dated 2019                                        |             186 |             186 | ✅  |
| Live lines dated 2020                                        |           1,438 |           1,438 | ✅  |
| Live lines dated 2021                                        |           1,037 |           1,037 | ✅  |
| Live lines dated 2022                                        |           1,403 |           1,403 | ✅  |
| Live lines dated 2023                                        |           1,431 |           1,431 | ✅  |
| Live lines dated 2024                                        |           1,645 |           1,645 | ✅  |
| Live lines in all                                            |           7,140 |           7,140 | ✅  |
| Σ debits                                                     |   13,303,638.68 |   13,303,638.68 | ✅  |
| Σ credits                                                    |   13,303,638.68 |   13,303,638.68 | ✅  |
| Bridge lines (all SREI, so none expected)                    |               0 |               0 | ✅  |
| Lines attributed to another entity than the header           |               0 |               0 | ✅  |
| 1101 balance at 2024-12-31 (ledger)                          |          523.80 |          523.80 | ✅  |
| 1102 balance at 2024-12-31 (ledger)                          |            0.00 |            0.00 | ✅  |
| 1103 / 1104 postings in 2019–2024                            |               0 |               0 | ✅  |
| Posted entries stored as bank / journal / adjusting _(info)_ | 2816 / 47 / 132 | 2816 / 47 / 132 | ✅  |

#### Database · 2019–2024 class × sub-type (all years) — 72/72 ✅

All 72 cells match to the cent.

#### Database · 2024 class × sub-type (workbook pivot) — 72/72 ✅

All 72 cells match to the cent.

#### Database · 2025 — 22/22 ✅

| Check                                                                               |       Expected |         Actual |     |
| ----------------------------------------------------------------------------------- | -------------: | -------------: | :-: |
| Transactions imported                                                               |            833 |            833 | ✅  |
| Posted                                                                              |            832 |            832 | ✅  |
| Flagged drafts (the split row)                                                      |              1 |              1 | ✅  |
| Bank lines on 1101 (posted + flagged)                                               |            623 |            623 | ✅  |
| Bank lines on 1103 (posted + flagged)                                               |            172 |            172 | ✅  |
| Bank lines on 1104 (posted + flagged)                                               |             38 |             38 | ✅  |
| Net cash movement across 1101 + 1103 + Venmo (posted + flagged, as in the snapshot) |      10,891.95 |      10,891.95 | ✅  |
| Net cash movement, posted rows only (what reports and the bank balance show)        |      18,696.20 |      18,696.20 | ✅  |
| Rows with cross-entity bridge lines                                                 |             92 |             92 | ✅  |
| Rows tagged needs_model_split                                                       |             93 |             93 | ✅  |
| Rows verified by Jose                                                               |            357 |            357 | ✅  |
| Rows expecting receipts                                                             |            121 |            121 | ✅  |
| Receipt files expected                                                              |            129 |            129 | ✅  |
| Rows carrying a flag reason                                                         |              1 |              1 | ✅  |
| Rows with a Row ID                                                                  |            797 |            797 | ✅  |
| Rows with a blank “Filled in by”                                                    |            166 |            166 | ✅  |
| Home entity SREI (1101 + Venmo rows)                                                |            661 |            661 | ✅  |
| Home entity PLA (1103 rows)                                                         |            172 |            172 | ✅  |
| User notes carried over                                                             |             75 |             75 | ✅  |
| System notes (provenance + snapshot ledger notes + import notes) _(info)_           | at least 1,287 | at least 1,287 | ✅  |
| Providence rows on 1101                                                             |             89 |             89 | ✅  |
| Net of the Providence rows on 1101                                                  |      −9,955.79 |      −9,955.79 | ✅  |

#### Tax years — 9/9 ✅

| Check                          | Expected | Actual |     |
| ------------------------------ | -------: | -----: | :-: |
| SREI 2019                      |    FILED |  FILED | ✅  |
| SREI 2020                      |    FILED |  FILED | ✅  |
| SREI 2021                      |    FILED |  FILED | ✅  |
| SREI 2022                      |    FILED |  FILED | ✅  |
| SREI 2023                      |    FILED |  FILED | ✅  |
| SREI 2024                      |    FILED |  FILED | ✅  |
| SREI 2025                      |     OPEN |   OPEN | ✅  |
| PLA 2025                       |     OPEN |   OPEN | ✅  |
| PLA years before 2025 _(info)_ |     none |   none | ✅  |

#### Reference models — 5/5 ✅

| Check                | Expected | Actual |     |
| -------------------- | -------: | -----: | :-: |
| 2020 models archived |        3 |      3 | ✅  |
| 2021 models archived |        8 |      8 | ✅  |
| 2022 models archived |        5 |      5 | ✅  |
| 2023 models archived |        5 |      5 | ✅  |
| 2024 models archived |        7 |      7 | ✅  |

## Chart of accounts: workbook vs seed

In the workbook's chart but not in the seed: none.

In the seed but not in the workbook's chart: 1104, 1313, 1315, 4103, 5226, 5227.

Differences:

- 1501 appears 2 times in the workbook's chart (1500 Accounts Receivable / Asset / Other Current Liabilities and 2100 Other Current Liabilities / Liability / Other Current Liabilities); the seed keeps one Asset account under 1500 Accounts Receivable (decision D5).
- 1501 Tenant Rent Due: workbook type Liability, seed type ASSET.
- Income and Expense accounts are typed “Equity” in the workbook; the seed types them by sub-type (Income / Expense), as DATA_SOURCES.md prescribes.

## Rows and questions needing a human

### Flagged draft (not posted)

- #464 2025-09-18 Eureka Ergonomic -7,804.25 (Providence, PLA (1103)): the snapshot carried it as “(split - varies)” — capitalize vs expense between 1313 and 5215; the full amount sits on 1313 as a flagged draft until Jose itemises the desks and chairs. Until it is confirmed, the PLA bank balance in the app (posted rows only) is 7,804.25 higher than the bank statement, and the row is in no report.

### Open questions from the snapshot's “Questions for Jose” sheet

- **3. Property tax** (-4168.08, 2025-09-23): Keystone 09/23 for 136 Sunnyside: the 2024 bill x 1.05106 comes to $2,706.82, not the $4,168.08 actually billed - off by $1,461.26 against a formula that held for six other properties. _Why it matters: Reassessment, or does this bill cover more than one period? Still genuinely unanswered._
- **4. PLA startup** (-4000, 2025-06-13): Comply 06/13 ($3,000) and 10/02 ($1,000): both currently booked as 5102 Incorporation Expenses. Is the October charge really a startup cost, or ongoing compliance service that should be a different account? _Why it matters: Startup costs amortize under Sec. 195; ongoing compliance is a current deduction._
- **5. PLA startup** (5000, 2025-06-02): $5,000 landed in the PLA account 06/02, classed as a capital contribution. Who actually sent it - was it from Jose personally? _Why it matters: This is PLA's opening capital. If it wasn't from Jose, the equity picture changes._
- **6. Furniture** (-7804.25, 2025-09-18): Eureka Ergonomic 09/18 $7,804.25: split between capitalized furniture and expensed supplies, but no item-level detail behind that split. How many desks and chairs, and what did each cost? _Why it matters: Items under $2,500 each can be expensed under de minimis; over that they capitalize and depreciate. This is one of only two rows still carrying a split - deliberately not unsplit with the rest, since it's a capitalize-vs-expense question, not a property allocation._
- **7. Travel** (-436.96, 2025-06-27): Southwest 06/27 $436.96: business trip or personal? The 08/01 Southwest flight was the LU Foundation retreat and went to distributions - was this one different? _Why it matters: Currently sitting in Travel Expense / Providence; worth a direct confirmation._
- **8. Amazon** (-630.72): Three Amazon charges ($259.70, $253.34, $117.68) got Supplies Expense by pattern (83% of this year's Amazon charges use that account), not verified content. Nobody has actually looked at what was in these orders. _Why it matters: A pattern default - correct it if Jose or Jamin can pull the actual order history._
- **9. Double-check** (-180, 2025-01-24): The $180 Zelle payment on 01/24 has a bank memo reading "Zelle payment to Emilio Martinez," but Jose's edit set the vendor to "Jose and Jasmine Sabastro." Applied as instructed since it came directly from Jose's own review, but the mismatch is worth a second look next time he's in the sheet. _Why it matters: Could be a Zelle account-nickname thing, or could be a mix-up with a different row._
- **10. Rent - the remaining real question**: With the SRC/Maintenance Business correction above, is there still an actual lease for the Clubhouse and whatever Sabastro Consulting relationship remains, or did that go away with the reclassification? _Why it matters: Worth confirming there isn't a real lease question still sitting underneath the old mistaken framing._
- **12. Depreciation**: The 2025 depreciation schedule, roughly $60,000, comes from Jose's own TurboTax filing (Alison only handles payroll, not the return) and is not in the books yet. _Why it matters: The single largest deduction of the year._
- **13. For Alison (payroll only)**: 2025 payroll register showing gross versus net. _Why it matters: Wages are booked at net. Gross is what goes on the return._
- **14. For Alison (payroll only)**: Who was on SREI payroll in Q1 through Q3 2025? _Why it matters: Needed to tie out the 941s and the local income tax._
- **15. Sole-proprietor report**: Jose wants a report splitting everything dated before PLA's launch out as his old sole-proprietor consulting business. Needs PLA's actual launch date to build. _Why it matters: Several rows were classed Providence under this rule and are candidates for that report._

### Same-day identical rows (kept; each carries a system note naming the others)

- snapshot rows #10, #11, #12: 2025-01-07 -135.15 on Real Estate (1101) — McGovern
- snapshot rows #50, #54: 2025-01-29 -79.25 on Real Estate (1101) — State Farm
- snapshot rows #101, #106: 2025-03-03 -79.25 on Real Estate (1101) — State Farm
- snapshot rows #149, #159: 2025-03-31 -79.25 on Real Estate (1101) — State Farm
- snapshot rows #207, #212: 2025-04-29 -79.25 on Real Estate (1101) — State Farm
- snapshot rows #340, #345: 2025-07-07 2,850.00 on Real Estate (1101) — Carrie Paul-stein
- snapshot rows #835, #836: 2025-05-21 50.00 on Venmo — Bulldogs

### Expense accounts with money coming in (25 refunds / returns, posted as Dr bank / Cr expense)

- snapshot row #112 2025-03-04 Lowes +22.22 → 5206 Repairs and Maintenance Expense (Rentals:136 Sunnyside)
- snapshot row #120 2025-03-06 Lowes +64.98 → 5206 Repairs and Maintenance Expense (Rentals:136 Sunnyside)
- snapshot row #131 2025-03-13 Lowes +110.31 → 5206 Repairs and Maintenance Expense (Rentals:136 Sunnyside)
- snapshot row #281 2025-06-09 Lowes +27.52 → 5206 Repairs and Maintenance Expense (Rentals:142 Maloney Terrace)
- snapshot row #311 2025-06-24 Auto Zone +100.70 → 5206 Repairs and Maintenance Expense (General)
- snapshot row #360 2025-07-23 Lowes +211.51 → 5206 Repairs and Maintenance Expense (Rentals:176 Tulsk Road)
- snapshot row #403 2025-08-11 Lowes +16.40 → 5206 Repairs and Maintenance Expense (Rentals:176 Tulsk Road)
- snapshot row #414 2025-08-14 Lowes +22.62 → 5206 Repairs and Maintenance Expense (Rentals:544 Liberty Circle)
- snapshot row #415 2025-08-14 Lowes +30.70 → 5206 Repairs and Maintenance Expense (Rentals:544 Liberty Circle)
- snapshot row #418 2025-08-14 Lowes +10.31 → 5206 Repairs and Maintenance Expense (Rentals:544 Liberty Circle)
- snapshot row #486 2025-09-25 Lowes +142.04 → 5206 Repairs and Maintenance Expense (Providence)
- snapshot row #525 2025-10-03 Vernal +20.00 → 5215 Supplies Expense (Providence)
- snapshot row #533 2025-10-06 Lowes +40.59 → 5206 Repairs and Maintenance Expense (Rentals:176 Tulsk Road)
- snapshot row #535 2025-10-07 Lowes +600.96 → 5206 Repairs and Maintenance Expense (Providence)
- snapshot row #592 2025-10-21 Lowes +112.21 → 5206 Repairs and Maintenance Expense (Providence)
- snapshot row #597 2025-10-21 Lowes +42.38 → 5206 Repairs and Maintenance Expense (Rentals:176 Tulsk Road)
- snapshot row #606 2025-10-22 Lowes +154.84 → 5206 Repairs and Maintenance Expense (Providence)
- snapshot row #610 2025-10-24 Lowes +182.88 → 5206 Repairs and Maintenance Expense (Providence)
- snapshot row #616 2025-10-24 Walmart +315.88 → 5215 Supplies Expense (Providence)
- snapshot row #622 2025-10-29 Layla Grayce +1,825.17 → 5215 Supplies Expense (Providence)
- snapshot row #697 2025-11-17 Home Depot +23.96 → 5206 Repairs and Maintenance Expense (Providence)
- snapshot row #706 2025-11-20 Lowes +70.28 → 5206 Repairs and Maintenance Expense (Providence)
- snapshot row #724 2025-11-26 Lowes +52.96 → 5206 Repairs and Maintenance Expense (Providence)
- snapshot row #733 2025-12-01 Amazon +42.39 → 5215 Supplies Expense (Providence)
- snapshot row #789 2025-12-19 Lowes +13.34 → 5206 Repairs and Maintenance Expense (Rentals:176 Tulsk Road)

### Rows waiting for the allocation-model system (Phase 5)

- 93 rows are tagged `needs_model_split` (net -35,662.95): General 67, Providence 13, Rentals:136 Sunnyside 12, Maintenance Business 1. They were unsplit back to a single class on 2026-09-10 and are the first real use of the 2025 model once it exists.

### Pre-PLA Providence rows (sole-proprietor report, decision D2)

- 21 Providence rows on 1101 are dated before 2025-06-02 (the placeholder launch date = the PLA bank account opening). Jose's actual launch date decides which rows belong to the old sole-proprietor consulting business.

### 2019–2024 entries worth a glance

- 12 workbook numbers cover two bookings (all 2024): the monthly Clubhouse rent booked as income against a capital distribution (no cash) and, under the same number, whatever hit the bank next. They are kept together to match the workbook; each row shows the bank movement's vendor, date and amount and the rent booking is visible in its journal lines. **Question for Jose and Jamin: split them into two transactions?** The list is below.
- 7 entries are a payment and its reversal on the same bank account (net 0.00); they are stored as journal entries so both lines stay visible: #353 2020-06-01 John Boxler 25,000.00; #504 2020-09-02 Ciocca Chevrolet 1,245.42; #571 2020-10-23 Avon Grove School District 20,954.03; #928 2021-08-05 Chester County 6,902.69; #942 2021-08-06 Chester County 1,051.93; #947 2021-08-06 Franklin Township 576.70; #1034 2021-11-03 — 1,578.30.
- Transfer between the old and the current bank account: #25 (2019-05-02) — shown from 1101.
- 395 entries have no Name on any line (year-end reallocations, depreciation, and bank-side entries); the ledger shows “—” as the vendor.
- Wages: 13 2025 rows on 5226 Wages Expense are booked at net pay (decision D7); each carries a reminder note about the payroll register.

### Seed confirmations still open (docs/DESIGN.md §7)

- 1104 Venmo as the number and name for the Venmo cash account (decision D4).
- 1313, 1315, 4103, 5226, 5227: parents and types were inferred from the 2025 books.
- 1501 Tenant Rent Due kept as one Asset account under Accounts Receivable (decision D5).

### Receipts referenced by the snapshot

- 121 rows expect 129 receipt files that are not in the workbook (`receipt_expected_count` is set on each row). Phase 3 uploads and links them.

## Details the import had to decide

- Negative amounts (P0-1): 43 lines in the year-end reallocation entries carry a negative debit or credit in the workbook; each is stored on the other side as a positive amount. Net totals are unchanged.

|  Txn |  Row | Account                   | Class                                    | In the workbook |   Stored as |
| ---: | ---: | ------------------------- | ---------------------------------------- | --------------: | ----------: |
| 1642 | 3943 | 3102 Capital Distribution | General                                  |        Dr -3.00 |     Cr 3.00 |
| 1642 | 3944 | 5212 Bank Fees            | Land Development:13 Chisel Creek Dr      |        Dr -1.57 |     Cr 1.57 |
| 1642 | 3945 | 5212 Bank Fees            | Rentals:The Clubhouse                    |        Dr -0.39 |     Cr 0.39 |
| 1642 | 3946 | 5212 Bank Fees            | Rentals:The Shed                         |        Dr -0.21 |     Cr 0.21 |
| 1642 | 3947 | 5212 Bank Fees            | Rentals:142 Maloney Terrace              |        Dr -0.23 |     Cr 0.23 |
| 1642 | 3948 | 5212 Bank Fees            | Rentals:176 Tulsk Road                   |        Dr -0.23 |     Cr 0.23 |
| 1642 | 3949 | 5212 Bank Fees            | Rentals:544 Liberty Circle               |        Dr -0.23 |     Cr 0.23 |
| 1642 | 3950 | 5212 Bank Fees            | Rentals:533 Mystic Lane                  |        Dr -0.14 |     Cr 0.14 |
| 1642 | 3951 | 5212 Bank Fees            | General                                  |        Cr -3.00 |     Dr 3.00 |
| 1642 | 3952 | 3101 Capital Contribution | Land Development:13 Chisel Creek Dr      |        Cr -1.57 |     Dr 1.57 |
| 1642 | 3953 | 3101 Capital Contribution | Rentals:The Clubhouse                    |        Cr -0.39 |     Dr 0.39 |
| 1642 | 3954 | 3101 Capital Contribution | Rentals:The Shed                         |        Cr -0.21 |     Dr 0.21 |
| 1642 | 3955 | 3101 Capital Contribution | Rentals:142 Maloney Terrace              |        Cr -0.23 |     Dr 0.23 |
| 1642 | 3956 | 3101 Capital Contribution | Rentals:176 Tulsk Road                   |        Cr -0.23 |     Dr 0.23 |
| 1642 | 3957 | 3101 Capital Contribution | Rentals:544 Liberty Circle               |        Cr -0.23 |     Dr 0.23 |
| 1642 | 3958 | 3101 Capital Contribution | Rentals:533 Mystic Lane                  |        Cr -0.14 |     Dr 0.14 |
| 2244 | 5396 | 3102 Capital Distribution | General                                  |        Dr -1.00 |     Cr 1.00 |
| 2244 | 5397 | 5212 Bank Fees            | Land Development:1671-1675 New London Rd |        Dr -0.08 |     Cr 0.08 |
| 2244 | 5398 | 5212 Bank Fees            | Rentals:The Shed                         |        Dr -0.07 |     Cr 0.07 |
| 2244 | 5399 | 5212 Bank Fees            | Rentals:The Clubhouse                    |        Dr -0.11 |     Cr 0.11 |
| 2244 | 5400 | 5212 Bank Fees            | Land Development:13 Chisel Creek Dr      |        Dr -0.49 |     Cr 0.49 |
| 2244 | 5401 | 5212 Bank Fees            | Rentals:176 Tulsk Road                   |        Dr -0.08 |     Cr 0.08 |
| 2244 | 5402 | 5212 Bank Fees            | Rentals:142 Maloney Terrace              |        Dr -0.08 |     Cr 0.08 |
| 2244 | 5403 | 5212 Bank Fees            | Rentals:544 Liberty Circle               |        Dr -0.08 |     Cr 0.08 |
| 2244 | 5404 | 5212 Bank Fees            | General                                  |        Cr -1.00 |     Dr 1.00 |
| 2244 | 5405 | 3101 Capital Contribution | Land Development:1671-1675 New London Rd |        Cr -0.08 |     Dr 0.08 |
| 2244 | 5406 | 3101 Capital Contribution | Rentals:The Shed                         |        Cr -0.07 |     Dr 0.07 |
| 2244 | 5407 | 3101 Capital Contribution | Rentals:The Clubhouse                    |        Cr -0.11 |     Dr 0.11 |
| 2244 | 5408 | 3101 Capital Contribution | Land Development:13 Chisel Creek Dr      |        Cr -0.49 |     Dr 0.49 |
| 2244 | 5409 | 3101 Capital Contribution | Rentals:176 Tulsk Road                   |        Cr -0.08 |     Dr 0.08 |
| 2244 | 5410 | 3101 Capital Contribution | Rentals:142 Maloney Terrace              |        Cr -0.08 |     Dr 0.08 |
| 2244 | 5411 | 3101 Capital Contribution | Rentals:544 Liberty Circle               |        Cr -0.08 |     Dr 0.08 |
| 2260 | 5490 | 4101 Rental Income        | Rentals:533 Mystic Lane                  |     Dr -5833.33 | Cr 5,833.33 |
| 2260 | 5491 | 1303 Accum Dep - Building | Rentals:533 Mystic Lane                  |     Cr -5833.33 | Dr 5,833.33 |
| 2987 | 7010 | 5212 Bank Fees            | General                                  |       Cr -21.00 |    Dr 21.00 |
| 2987 | 7029 | 5212 Bank Fees            | Land Development:1671-1675 New London Rd |        Dr -1.66 |     Cr 1.66 |
| 2987 | 7040 | 5212 Bank Fees            | Rentals:The Shed                         |        Dr -1.40 |     Cr 1.40 |
| 2987 | 7051 | 5212 Bank Fees            | Rentals:The Clubhouse                    |        Dr -2.33 |     Cr 2.33 |
| 2987 | 7062 | 5212 Bank Fees            | Land Development:13 Chisel Creek Dr      |        Dr -8.53 |     Cr 8.53 |
| 2987 | 7071 | 5212 Bank Fees            | Rentals:176 Tulsk Road                   |        Dr -1.77 |     Cr 1.77 |
| 2987 | 7080 | 5212 Bank Fees            | Rentals:142 Maloney Terrace              |        Dr -1.77 |     Cr 1.77 |
| 2987 | 7089 | 5212 Bank Fees            | Rentals:544 Liberty Circle               |        Dr -1.77 |     Cr 1.77 |
| 2987 | 7098 | 5212 Bank Fees            | Rentals:136 Sunnyside                    |        Dr -1.77 |     Cr 1.77 |

- Zero-amount entries (P0-3): transactions 2623, 2624, 2625, 2626 are voided placeholders with no lines.
- Workbook numbers that cover two bookings (kept together, decision P2-3): 12. Each row is dated on the bank movement and carries its vendor; the rent booking sits in the journal lines. 4 of them carry two dates in the workbook (#2264: 2024-01-01 / 2024-01-02; #2531: 2024-06-01 / 2024-06-03; #2724: 2024-09-01 / 2024-09-03; #2898: 2024-12-01 / 2024-12-02).

| Workbook # | Row date   | Bank movement                      | Booked with it (no cash)                                                                                                     | Sheet rows |
| ---------: | ---------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------- |
|       2264 | 2024-01-02 | Zoom 16.95                         | Sabastro Consulting 3,000.00 — 4101 Rental Income · Rentals:The Clubhouse; 3102 Capital Distribution · Rentals:The Clubhouse | 5498–5501  |
|       2327 | 2024-02-01 | La Verona 26.32                    | Sabastro Consulting 3,000.00 — 4101 Rental Income · Rentals:The Clubhouse; 3102 Capital Distribution · Rentals:The Clubhouse | 5626–5629  |
|       2374 | 2024-03-01 | Talula's 18.02                     | Sabastro Consulting 3,000.00 — 4101 Rental Income · Rentals:The Clubhouse; 3102 Capital Distribution · Rentals:The Clubhouse | 5722–5725  |
|       2428 | 2024-04-01 | McGovern 135.15                    | Sabastro Consulting 3,000.00 — 4101 Rental Income · Rentals:The Clubhouse; 3102 Capital Distribution · Rentals:The Clubhouse | 5832–5835  |
|       2480 | 2024-05-01 | Jose and Jasmine Sabastro 5.29     | Sabastro Consulting 3,000.00 — 4101 Rental Income · Rentals:The Clubhouse; 3102 Capital Distribution · Rentals:The Clubhouse | 5938–5941  |
|       2531 | 2024-06-03 | Brooke Wallace 900.00              | Sabastro Consulting 3,000.00 — 4101 Rental Income · Rentals:The Clubhouse; 3102 Capital Distribution · Rentals:The Clubhouse | 6042–6045  |
|       2598 | 2024-07-01 | Jose and Jasmine Sabastro 5.29     | Sabastro Consulting 3,000.00 — 4101 Rental Income · Rentals:The Clubhouse; 3102 Capital Distribution · Rentals:The Clubhouse | 6186–6189  |
|       2658 | 2024-08-01 | Lowes 69.81                        | Sabastro Consulting 3,000.00 — 4101 Rental Income · Rentals:The Clubhouse; 3102 Capital Distribution · Rentals:The Clubhouse | 6304–6307  |
|       2724 | 2024-09-03 | Jose and Jasmine Sabastro 4,000.00 | Sabastro Consulting 3,000.00 — 4101 Rental Income · Rentals:The Clubhouse; 3102 Capital Distribution · Rentals:The Clubhouse | 6438–6441  |
|       2779 | 2024-10-01 | Verizon 69.99                      | Sabastro Consulting 3,000.00 — 4101 Rental Income · Rentals:The Clubhouse; 3102 Capital Distribution · Rentals:The Clubhouse | 6554–6557  |
|       2831 | 2024-11-01 | Lowes 285.41                       | Sabastro Consulting 3,000.00 — 4101 Rental Income · Rentals:The Clubhouse; 3102 Capital Distribution · Rentals:The Clubhouse | 6673–6676  |
|       2898 | 2024-12-02 | Sunoco 53.66                       | Sabastro Consulting 3,000.00 — 4101 Rental Income · Rentals:The Clubhouse; 3102 Capital Distribution · Rentals:The Clubhouse | 6809–6812  |

- Payment-and-reversal entries on one bank account (stored as journal entries, net 0.00): #353 2020-06-01 John Boxler 25,000.00 (rows 797–798); #504 2020-09-02 Ciocca Chevrolet 1,245.42 (rows 1103–1104); #571 2020-10-23 Avon Grove School District 20,954.03 (rows 1237–1238); #928 2021-08-05 Chester County 6,902.69 (rows 2088–2089); #942 2021-08-06 Chester County 1,051.93 (rows 2122–2123); #947 2021-08-06 Franklin Township 576.70 (rows 2132–2133); #1034 2021-11-03 — 1,578.30 (rows 2358–2359).
- Transfers between own bank accounts: #25 (shown from 1101, decision P1-18).
- 395 entries have no Name on any line (year-end reallocations, depreciation, bank-side entries); they show “—” as the vendor and keep their memo.
- 144 formula cells had no cached value and were read as 0.00; 194 amounts carried fractions of a cent and were rounded per line (every entry still balances).
