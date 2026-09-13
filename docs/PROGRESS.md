# PROGRESS.md — session hand-off

Read this after `CLAUDE.md` at the start of every session. Write to it last.

## Where we are

**Phase 1 (core ledger) — DONE on 2026-09-12 and pushed.** Phase 0 (design, scaffold, auth, app shell)
was done the same day.

Next session: **Phase 2 — historical import.** Paste the Phase 2 prompt from `KICKOFF_PROMPTS.md`.
Before starting, read the "Notes for Phase 2" section at the bottom of this file.

## Done in Phase 1

- **Schema + migration** `prisma/migrations/20260912200000_phase1_ledger`: `transactions`,
  `transaction_lines`, `notes`, `tax_year_checklist`, `saved_views`, plus hand-written SQL rules:
  - debit/credit non-negative with exactly one non-zero per line; void/posted field requirements;
    import idempotency key `(source_file, source_ref)`; one user note per transaction;
  - **deferred balance trigger** (runs at commit): every entity present among the live lines balances,
    at least two live lines unless voided, a posted transaction has account + class + entity on every
    live line, split children point at a superseded parent of the same transaction and add up to it;
  - **attribution trigger**: a bank line belongs to its bank account's entity, any other line to its
    class's entity, General to the home entity; bridge lines are exempt from the class rule (they
    carry the class they received, which may be the other entity's);
  - **posted lines are immutable**: never deleted, only superseded (`superseded_at` +
    `superseded_by_audit_id`); voided lines cannot be touched at all;
  - **tax-year lock trigger** on transactions and lines (every entity involved, old and new date;
    drafts exempt) with the `app.lock_override_reason` override; **system notes append-only**;
    `ledger_app` cannot delete transactions or notes.
- **Accounting core** (`src/lib/ledger/`): attribution, the general cross-entity bridge (per-entity net,
  payer `Dr 3102` General / receiver `Cr 3101` per class, accounts from Settings → bridge rules),
  simple-row → lines, derived bank lines on the row's own bank account (one per class; a transfer's other bank line is an ordinary account line, P1-18), split math (amounts or percentages, remainder
  to the largest share), and every operation: create bank transaction / journal entry (draft or posted),
  edit, inline account/class edit, split, unsplit, post, void, flag, user + system notes, tax-year
  checklist / close / file / re-open, saved views. Every write: lock guard → one audit row with
  before/after → header update → supersede-and-insert lines, all in one database transaction.
- **Ledger screen** (`/ledger`): TanStack Table grid scoped to the top-bar entity + year; search across
  vendor/memo/notes/accounts/amounts; status chips as toggles (Voided hidden by default); account,
  class, bank and type filters; sorting; page size; totals footer (money in / out / net); journal view
  toggle (one row per line, debits = credits footer); saved views (private, per user); inline edit of
  account and class on unsplit rows; provenance popover; receipt icon → placeholder viewer; notes icon;
  row menu (open, edit, split/unsplit, post, void); keyboard shortcuts (j/k, Enter, e, s, v, p, n, /).
  Details drawer: journal lines with per-line inline edit and split, "show replaced lines" history,
  provenance, notes (append-only system notes + editable user note), audit history of the transaction.
  Dialogs: simple row (save as draft / save and post), multi-line journal entry (adjusting checkbox,
  live balance), split (by amount or percent, cent preview), unsplit, void (typed reason), post.
- **Closed/filed year flow**: the full-screen warning (wording escalates for FILED), typed reason, one
  `tax_year.override` audit row per affected year, `override_count` bump, "overridden N times" badge on
  the ledger banner and the Tax Years pages. Any action that hits a locked year returns `needsOverride`
  and the UI retries with the reason.
- **Tax Years**: list with posted/open counts and override badges; per-year page with the year-end
  checklist (two items automatic — "no drafts" and "adjusting entries booked"; three stubbed until
  Phases 4/5/6 — tick by hand or override with a reason), Mark closed (gated), Mark filed, Re-open
  (Owner only, audited override), and the list of overrides on that year.
- **Tests**: `pnpm test` = 13 files / 113 tests, all green, incl. `tests/core/ledger.test.ts` (28 tests
  against the real database with the restricted role: simple rows, cross-entity bridge in both
  directions, inline edit regenerating the bridge, split by amount and by percent, unsplit, journal
  entries, void, the lock (closed, filed, both entities, date changes, override + audit + count), the
  database invariants, notes, year-end close/file/re-open, saved views), `tests/core/bridge.test.ts`,
  `tests/core/split.test.ts`. Playwright smoke test extended: sign in → enrol → dashboard → **ledger:
  enter and post a transaction** → settings → sign out → sign in again.
- **Fix on 2026-09-13** (found by Jamin during verification): a row whose account is another bank
  account (a transfer) showed $0.00 and could not be edited, because every bank-type line was treated as
  derived. Now only the row's own bank account line is derived (DECISIONS P1-18); the account picker
  keeps bank accounts in a separate "transfers" group at the bottom and hides closed bank accounts.
- **Checks on 2026-09-12**: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` all green, plus a
  manual browser walk-through of every flow in the definition of done (create, edit, split, unsplit,
  void, journal entry, cross-entity row seen from both entities, checklist → close → warning →
  override → badge, Activity tab).

## How to try it

On this Mac (no Docker): `pnpm dev:nodocker`, then open <http://localhost:3000> (if that shows a
different program, use <http://[::1]:3000> — another process on this Mac holds the IPv4 side of port
3000). Logins are in `.env`. If the ledger page ever shows "Cannot read properties of undefined", the
app is still running with an old database client: stop it (Ctrl-C) and start it again.

What to click, in order:

1. **Ledger** (SREI · 2025 in the top bar). Press **N** or click **New transaction**: date, vendor,
   amount (negative = money out), account, class, bank account → **Save and post**. The row appears
   with a Posted chip. Double-click it (or press Enter with it selected) to see the two journal lines.
2. Enter one with class **Providence** on the SREI bank. The drawer shows four lines: the expense on
   PLA, the bank line on SREI, and the two bridge lines (3102 on SREI, 3101 on PLA). Switch the entity
   to **PLA**: the same row is in PLA's ledger with the `PLA↔SREI` marker.
3. In the drawer click **Split**: 150 to Providence, 100 to Rentals:The Shed → two expense lines, one
   bank line per class, a bridge for the 150 only. **Unsplit** brings it back. Tick **Show replaced
   lines** to see the full history struck through; the **History** tab lists every change.
4. Click the account or class cell of an unsplit row to change it in place. Use the row menu (⋯) or
   **v** to void with a reason; toggle **Voided** in the toolbar to see it.
5. **Journal entry** → a depreciation entry (5301 debit / 1303 credit); the footer says "Balanced".
6. **Tax Years / History** → open 2025 → tick or override the checklist → **Mark closed**. Back in the
   ledger, edit a posted row: the full-screen warning appears, asks for a reason, and the banner then
   says "overridden 1 time". **Settings → Activity** shows every one of these actions (filter
   "Closed-year overrides only").
7. A **transfer** between your own accounts: New transaction on 1101 with Account = **1104 Venmo** (the
   bank accounts sit in their own group at the bottom of the list). Two lines, no bridge, and the row
   shows the amount that moved. Closed bank accounts such as the old 1102 are not offered.

The dev database still holds the walk-through rows (three posted, one voided, in SREI/PLA 2025), the
smoke test's "Smoke Vendor" rows, and PLA 2025 was closed and re-opened (override count 1). They are
harmless examples; `pnpm db:recreate` wipes everything (you will re-enrol your authenticator). The
"Claude QA" user created for the walk-through is deactivated.

## Blocked / needs a human

- **Docker Desktop** is still not installed on this Mac (needs an admin password); the embedded Postgres
  fallback works. The project folder is still inside Google Drive; moving it to `~/Projects` is still
  recommended.
- The five questions at the end of `docs/DESIGN.md` are still open (defaults in force).

## Questions for Jose & Jamin (defaults in force meanwhile)

1. The questions in `docs/DESIGN.md` §7 (PLA launch date, PLA tax form, seed
   confirmations, sign-in emails).
2. **Money in for one entity landing in the other's bank** (a PLA client paying into the SREI account):
   the app books it as PLA `Dr 3102 Capital Distribution` and SREI `Cr 3101 Capital Contribution` with
   the Providence class — the money went through Jose. Is that how you want it shown? (DESIGN §3;
   DECISIONS P1-2.)
3. **Bank lines per class**: when a row is split across classes, the bank side is split the same way so
   each class balances on its own (the way the 2019–2024 workbook's per-class Bank column works). Any
   objection? (P1-1.)
4. **Posting directly**: anyone with "Review and confirm" can use "Save and post" on a hand-entered row
   without going through the review queue. Keep, or force every entry through the queue? (P1-8.)

## Known gaps / notes for later phases

- The ledger loads a whole entity-year at once and filters/sorts/pages in the browser. Fine for a few
  thousand rows; if the Phase 2 import makes 2024 (1,649 lines) feel slow, add row virtualisation.
- Receipt viewer is a placeholder (Phase 3). The review queue (Phase 3) should reuse `SplitDialog`,
  `TransactionDialog`, `PostDialog` and `useLockedYearFlow` from `src/components/ledger/`.
- Inline account/class editing in the grid works on unsplit rows; split rows are edited line by line in
  the drawer. Editing a journal entry replaces all of its lines (parent links reset).
- Reports (Phase 6) must read live lines only (`superseded_at IS NULL`) and `POSTED` rows; the
  "closed — overridden N times" badge already exists on the ledger banner and Tax Years pages.
- `docs/DESIGN.md` §1 lists `tax_year_documents`; the table arrives in Phase 6 with the History area.
- Settings tabs AI, Models, Tax mapping, Data are still greyed placeholders.
- Dev-only: the Phase 1 migration file was corrected once before commit; the local dev database's
  recorded checksum was updated to match, so `prisma migrate status` is clean. Any other database gets
  the final file.

## Notes for Phase 2 (import)

- Use `createBankTransaction` / `createJournalEntry` only for hand entry. The importer needs a lower-level
  path that writes the workbook's lines **as they are** (no derived bank lines), computes attribution
  and bridge lines, and sets `source = IMPORT`, `source_file`, `source_ref` (unique together),
  `source_ref_2`, `filled_in_by`, `verified_by_owner`, `classification_source = IMPORT`,
  `needs_model_split`, `receipt_expected_count`, `source_row` per line. Add an `explicitLines` option to
  `buildDesiredLines` (skip `deriveBankLines`) rather than a second code path.
- 2019–2024 entries are already balanced journal lines (some with several bank lines); 2025 rows are
  simple rows (`amount < 0 → Dr account / Cr bank`). Negative debits → credits (P0-1). The four
  zero-amount 2024-07-12 rows import as `VOIDED` with no lines (P0-3) — the triggers allow that.
- Entity of an imported entry = the bank account's entity; the 89 Providence rows on `1101` get bridge
  lines automatically; check the 9 General rows on `1103` need none (DATA_SOURCES.md).
- Tax years 2019–2024 are `FILED` in the seed, so the importer must run with the lock override set
  (`applyLockOverride` in `src/lib/ledger/locks.ts`, or `set_config('app.lock_override_reason', …, true)`
  in the same transaction) and record one audit row for the import rather than one per year.
- Keep `seq` for the app; the workbook's Transaction # goes in `source_ref`.
- For a 2019–2024 entry that touches two bank accounts (a transfer), set `bank_account_id` to the bank
  the row was entered from (the `1101` side when in doubt): it decides which bank line is the derived
  side, which one is editable, and the sign of the amount the ledger shows (P1-18).
