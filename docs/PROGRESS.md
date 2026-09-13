# PROGRESS.md — session hand-off

Read this after `CLAUDE.md` at the start of every session. Write to it last.

## Where we are

**Phase 2 (historical import) — DONE on 2026-09-13.** Phases 0 and 1 were done on 2026-09-12.

Next session: **Phase 3 — receipts, AI classifier, review queue.** Paste the Phase 3 prompt from
`KICKOFF_PROMPTS.md`. Before starting, read the "Notes for Phase 3" section at the bottom of this file.

## Done in Phase 2

- **The books are in.** `pnpm import:run` reads the two private workbooks in `data/source/` and loads
  2,999 transactions for 2019–2024 (7,140 lines exactly as written; 4 zero-amount placeholders voided;
  12 workbook numbers that cover two bookings are kept together with the header taken from the bank
  movement, P2-3),
  833 transactions for 2025 (832 posted, the Eureka Ergonomic split row as a flagged draft) and 28
  archived reference allocation models (the 2020–2024 Tax Worksheets). Every number in the
  `DATA_SOURCES.md` acceptance checklist is reproduced — **498 of 498 checks pass to the cent** — first
  from the files, then read back from the database inside the same transaction before commit. Second
  run: 0 / 0 / 0 inserted in about two seconds. The report is `docs/IMPORT_REPORT.md` (also in
  Settings → Data).
- **Import library** `src/lib/import/`: `xlsx.ts` (exceljs helpers, cached formula results), `workbook-a.ts`
  and `workbook-b.ts` (the readers; nothing "improved"), `checklist.ts` (the acceptance list as code, with
  the full-period and 2024 class × sub-type tables), `reference-models.ts` (zod schema for
  `seed/reference_models/<year>.json`, cell-by-cell verification against the workbook, shares → basis
  points), `load.ts` (workbook rows → the ledger core's line shapes, bulk insert, provenance notes),
  `verify-db.ts` (the checklist read back from the database), `report.ts` (Markdown), `run.ts` (one
  database transaction: lock override, tax-year states, idempotent load, models, checks, one
  `import.run` audit row; a critical miss rolls everything back), `status.ts` (Settings → Data).
  Terminal: `scripts/import/run.ts` (`pnpm import:run`, `pnpm import:dry-run`).
- **Schema + migration** `prisma/migrations/20260913120000_phase2_import`: `import_runs`;
  `allocation_models`, `allocation_model_versions`, `allocation_targets` per DESIGN §1 with their rules
  (immutable versions/targets, Σ share = 100 % and one remainder target per version, model ↔ tax-year
  entity, line ↔ model year); FKs from `transaction_lines` to versions/targets.
- **Ledger core**: `buildDesiredLines(…, { explicitLines: true })` writes lines as given (no derived bank
  side) while still computing attribution and the bridge — used only by the import.
- **Settings → Data** (`/settings/data`): the two source files (present, SHA-256, size, what is imported
  from each), "Check without writing" / "Re-run import" (Owner or Full), every run with who / when /
  inserted / skipped / checks, the archived reference models with their shares, the report rendered
  in-app (`/settings/data/report`, `?run=<id>` for older runs) and downloadable as `.md`.
- **Decisions** P2-1 … P2-22 in `docs/DECISIONS.md`; corrections to the Phase 0 counts are noted at the
  top of `DATA_SOURCES.md` and at the end of `docs/WORKBOOK_VERIFICATION.md`.
- **Tests**: `pnpm test` = 14 files / 125 tests, incl. `tests/core/import.test.ts` (pure rules, the two
  readers on small workbooks built in the test, the loader against the database with the restricted role,
  allocation immutability and share rules, and the whole import twice when the workbooks are on the
  machine). `pnpm typecheck` and `pnpm lint` clean.
- **Verification method**: a separate agent re-derived every acceptance number with Python/openpyxl
  without seeing the TypeScript; both agree with each other and with the documents. The five worksheet
  transcriptions were each verified by an independent agent and are re-verified by the import on every
  run (every cell-addressed number, the sheet's cell count, and each allocated bill against its set). A
  five-lens adversarial review of the first commit produced 36 findings; the real ones (the twelve merged
  2024 entries, floored shares, a download route without the settings check, a re-run that would fail
  after the first legitimate edit, stuck "running" rows, and more) are fixed in the second commit.

## How to try it

On this Mac (no Docker): `pnpm dev:nodocker`, then open <http://[::1]:3000> (127.0.0.1:3000 belongs to an
unrelated program; if the app picked another port it says so in the Terminal). Logins are in `.env`.
The dev database already holds the import (run twice on 2026-09-13), so you do not need to run it again.

What to click, in order:

1. **Tax Years / History** with **SREI** in the top bar: 2019–2024 show **Filed** with their posted
   counts (2019: 91 · 2020: 636 · 2021: 383 · 2022: 544 · 2023: 609 · 2024: 732, plus 4 voided
   placeholders), 2025 **Open** with 661 imported rows (plus the handful of Phase 1 walk-through and
   smoke-test rows already in the dev database). Switch to **PLA**: only 2025, Open, 171 posted + 1 open
   (the flagged Eureka Ergonomic row).
2. **Ledger** SREI · 2024: 736 rows. Search `Reallocation` — the year-end entries; sort by date and open
   the 2024-12-31 "Reallocation of shared expenses" row (workbook transaction 2987) to see a 100-line
   adjusting entry with the `5212 Bank Fees` credits that the workbook held as negatives. Every row shows "Imported from the
   workbooks" in its provenance popover and a system note naming the sheet rows.
3. **Ledger** SREI · 2025: 668 rows (661 imported). Filter class **Providence**: the 89 rows paid from
   1101 (and 3 via Venmo) carry the `PLA↔SREI` marker; open one to see the bridge lines. Switch the
   entity to **PLA**: the same 92 rows appear in PLA's ledger next to the 172 rows on the PLA bank.
4. The one flagged draft (#464 Eureka Ergonomic, capitalize vs expense) sits in the **PLA · 2025 ledger**
   with a Flagged chip (the Review page is still the Phase 0 placeholder; the queue arrives in Phase 3).
5. **Settings → Data**: both files present with their SHA-256, the runs listed (one dry run, the real
   import, and the re-runs that inserted nothing), "Open import report", the 28 reference models with
   their percentages. Press **Check without writing**: "nothing new to
   import; 498 of 498 checks pass".
6. **Settings → Activity**: filter on actions starting with `import.` — `import.run` for a real run (the
   first one is marked as a closed-year override because the 2019–2024 years are filed), `import.dry_run`
   for rehearsals, `import.failed` when a run stopped.

## Blocked / needs a human

- **Docker Desktop** is still not installed on this Mac (needs an admin password); the embedded Postgres
  fallback works. The project folder is still inside Google Drive; moving it to `~/Projects` is still
  recommended.
- The receipt files the 2025 snapshot references (129 files on 121 rows) are not in the workbook;
  `receipt_expected_count` is set on those rows. Jamin supplies the files in Phase 3.

## Questions for Jose & Jamin (defaults in force meanwhile)

1. The open questions in `docs/DESIGN.md` §7 (PLA launch date, PLA tax form, seed confirmations).
2. The snapshot's own open questions (Keystone tax bill, Comply startup cost, the $5,000 PLA opening
   capital, the Eureka split, the Southwest trip, three Amazon orders, the Zelle vendor mismatch, the
   Clubhouse lease) are listed in `docs/IMPORT_REPORT.md` under "Rows and questions needing a human".
3. Phase 1's three questions (money-in bridge class, bank lines per class, direct posting) still stand.
4. **Storage kind of the 2019–2024 year-end entries**: entries with no bank line dated 12-31 or touching
   depreciation are stored as _adjusting_ entries (132), the other no-bank entries as _journal_ entries
   (47, including the seven payment-and-reversal pairs). Fine as is, or should every no-bank entry be
   "adjusting"? (P2-2, P2-18.)
5. **Twelve 2024 entries that cover two bookings** (P2-3): the workbook numbered the monthly 3,000.00
   Clubhouse rent booking together with the next bank item. They are imported as one transaction each
   (the row shows the bank item; the rent booking sits in its journal lines). Should they be split into
   two transactions? The list is in `docs/IMPORT_REPORT.md` under "entries worth a glance".

## Known gaps / notes for later phases

- The ledger loads a whole entity-year in the browser; SREI 2024 (735 rows) and 2025 (661) are fine.
  The 100-line entry #2987 renders in the details drawer; row virtualisation is still optional.
- Reports (Phase 6) must read live lines only (`superseded_at IS NULL`) of `POSTED` rows; the 2019–2024
  voided placeholders and the flagged 2025 draft must stay out.
- Reference models are `is_reference = true`; Phase 5 must treat them as read-only (no new versions, no
  apply) and can offer "Copy to 2025" from them.
- Settings tabs AI, Models, Tax mapping are still greyed placeholders.
- Development only: `pnpm import:reset-dev` removes everything the import wrote from a local database
  (users, chart, classes, tax years, hand-entered rows and the audit log stay) so the import can run again
  after the importer changes; it was used once on this Mac on 2026-09-13 to re-import with the review
  fixes. The Terminal import needs `--user <email>` so the audit trail names the person running it.

## Notes for Phase 3 (receipts + AI classifier + review queue)

- Vendor memory has a real corpus now: 2,995 + 832 posted transactions with `verified_by_owner` on every
  2019–2024 row and on 357 of the 2025 rows. `vendor` is the header field; 395 of the 2019–2024 entries
  have no vendor (year-end and bank-side entries) — skip those when building memory.
- The review queue's first real items: the flagged #464 (capitalize vs expense) and, once receipts
  arrive, the 121 rows with `receipt_expected_count > 0` (match by `source_ref` / Row ID).
- `transactions.flags` already carries `{ code, reason, by, at }` objects (see `setFlag` and the import's
  `capitalize_vs_expense` flag); reuse the shape for AI flags.
- The system-note convention: one provenance note per imported row ("Imported from …"), the snapshot's
  own ledger note verbatim, and one note per decision the import made. AI reasoning notes should follow
  the same append-only pattern (`addSystemNote`).
