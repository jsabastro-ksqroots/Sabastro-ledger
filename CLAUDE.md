# CLAUDE.md — Sabastro Ledger

Private, login-protected web app for **Jose Sabastro** (owner of all businesses) and **Jamin** (his assistant / bookkeeper) to run the books for Jose's businesses in one place: general ledger, receipt- and bank-statement-driven bookkeeping with AI-assisted categorization, per-year allocation models for split costs, performance dashboards, locked tax-year history, and Excel exports for filing with TurboTax Business.

Two users today; more may be added with granular permissions. **Neither user writes code — you (Claude Code) do.** Explain decisions and instructions in plain English, as if to a smart colleague who has never opened a terminal.

## Read first, every session

1. This file, top to bottom.
2. `docs/PROGRESS.md` — what is done, what is next, open decisions, known bugs. (Created in Phase 0.)
3. `DATA_SOURCES.md` — whenever a task touches import, the chart of accounts, classes, or historical data.
4. `KICKOFF_PROMPTS.md` — the phase you were asked to run.

Do not begin a phase until you have read these. Do not re-decide things this file already decides; if you believe a decision is wrong, say so in one paragraph, state the cost of changing it, and continue with the decided approach unless Jamin says otherwise.

## The businesses

| Entity                               | Short    | What it is                                                                                  | Bank accounts                                                                                                           | Classes (in the ledger)                                                         | Tax filing                                                                                                      |
| ------------------------------------ | -------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Sabastro Real Estate Investments LLC | **SREI** | Holds rental properties and land; also a maintenance-services line since 2025               | `1101` Bank of America "Real Estate" checking (current); `1102` old BofA checking (2019 only); Venmo (cash-like, 2025+) | `General`, `Rentals:*`, `Land Development:*`, `Flips:*`, `Maintenance Business` | Partnership — Form 1065 (confirmed for 2020; confirm current) with rental real estate on Form 8825 per property |
| 544 Liberty LLC                      | —        | Single rental property, its own LLC                                                         | uses SREI's bank                                                                                                        | `Rentals:544 Liberty Circle`                                                    | Tracked as a class under SREI                                                                                   |
| 176 Tulsk LLC                        | —        | Single rental property, its own LLC                                                         | uses SREI's bank                                                                                                        | `Rentals:176 Tulsk Road`                                                        | Tracked as a class under SREI                                                                                   |
| Providence Legacy Advisors LLC       | **PLA**  | Registered investment advisory firm; Jose sole owner, Jamin the one employee; launched 2025 | `1103` Bank of America "PLA" checking (opened 2025-06-02)                                                               | `Providence`                                                                    | Unknown — Jamin will confirm (Schedule C vs. S-corp/1120-S)                                                     |

Notes that matter for design:

- The two single-property LLCs are **classes**, not separate ledgers, by Jose's choice. Model them so a class can later be promoted to its own entity without rewriting history (a class has an `entity_id`; a "legal entity" flag; a migration can re-point it).
- Before the PLA bank account existed, "Providence"-class rows were paid from the SREI bank (89 rows in 2025). Those are Jose's prior sole-proprietor consulting business. Jose wants a report that splits everything dated before PLA's launch out as that sole-proprietor business. **PLA launch date is an open input.**
- Jose's personal house sits on the 13 Chisel Creek property along with the Clubhouse, the Shed, and the developable land. Costs that touch the whole property (mowing fuel, umbrella insurance, county/township/school tax on the parcel) are split by an allocation model, and the personal-house share goes to `3102 Capital Distribution` (Jose's personal expense), not to an expense account.
- Personal money in from Jose → `3101 Capital Contribution`. Personal spending out of a business account → `3102 Capital Distribution`. This is how the books have always worked; keep it.

## Accounting model (non-negotiable)

- **Double-entry.** Every transaction is a journal entry with two or more lines. Sum of debits equals sum of credits, enforced in the application layer _and_ by a database constraint/trigger. The 2019–2024 books are already true double-entry (2,999 balanced entries); the app must be at least that rigorous.
- **Bank-centric entry.** Nearly every transaction starts life as a bank line. The UI shows the simple one-row view the users already know (date · vendor · amount · account · class · bank account · receipt · notes) and the system stores it as `Dr expense/asset, Cr bank` (money out) or `Dr bank, Cr income/equity/liability` (money in). Show the underlying lines on demand ("journal view"), not by default.
- **Money is integer cents** (`BIGINT`) in the database and in all arithmetic. Never floats. Format at the edge.
- **Transaction dates are calendar dates** (`DATE`), no time zone. Audit timestamps are `TIMESTAMPTZ`.
- **Chart of accounts** is seeded from `seed/chart_of_accounts.csv`. Account **numbers** are the stable identifiers; names are editable. Types are `Asset | Liability | Equity | Income | Expense` plus sub-types as in the seed. Users can add accounts in Settings; numbers must stay unique; accounts with postings cannot be deleted, only deactivated.
- **Classes** are seeded from `seed/classes.csv`. Every line carries a class. Classes belong to an entity (`General` is shared and resolves to the entity of the transaction's bank account). Classes can be deactivated, never deleted once used.
- **Entity attribution.** Reports for an entity include lines whose class belongs to that entity. When one entity's bank pays for another entity's class (e.g., SREI bank → `Providence` expense), the app auto-inserts bridging lines so _each entity balances on its own_: payer entity `Dr 3102 Capital Distribution`, receiving entity `Cr 3101 Capital Contribution` (Jose owns 100% of both, so the money moved through him). Make the bridge rule configurable per entity pair in Settings (alternative: intercompany "Due to/Due from" accounts). Default is distribution/contribution.
- **Cash basis for daily bookkeeping** (things are recorded when they hit the bank or Venmo). Year-end adjusting entries — depreciation (from TurboTax's schedule, ≈ $60k for 2025), security-deposit movements, capitalization/expense reclassifications — are manual journal entries flagged `adjusting`, entered by the users with the app's help.
- **Nothing is hard-deleted.** Transactions are voided with a reason. Every create/edit/void/confirm/lock/export is written to the audit log with who, when, before/after.

## Tax years

- One `tax_years` row per entity per calendar year with state `open → closed → filed`.
- **Open:** normal editing.
- **Closed** (books finished, numbers handed to the return): any edit, void, model change, or new posting dated in that year triggers a full-screen warning ("This tax year is closed and its numbers may already be on a filed return. Continue?"), requires a typed reason, and is audit-logged as an override. Reports show a "closed — overridden N times" badge if overrides exist.
- **Filed:** same as closed, plus the filed return (PDF) and any supporting documents are attached to the year and visible in a **History** area. The giant warning wording escalates: "This year has been FILED."
- 2019–2024 import as `filed`. 2025 imports as `open` (they are finishing it now). 2026 is created `open` on first use.
- Year-end checklist per entity (bank balances tied to statements, no drafts left, no flagged items, allocation model applied, adjusting entries booked, export generated) gates the "Mark closed" button; each item can be overridden with a reason.

## Transaction lifecycle

```
receipt uploaded ─┐
                  ├─► DRAFT (AI-proposed vendor/account/class + reasoning + confidence)
statement line ───┘        │
                           ├─► FLAGGED (AI unsure, duplicate suspected, receipt without bank line, bank line without receipt where one is expected, amount mismatch)
                           ▼
                        REVIEW QUEUE (weekly/monthly; single or bulk Confirm; edit; split; assign model)
                           ▼
                        POSTED (in the ledger; still editable with audit trail; year lock rules apply)
                           ▼
                        VOIDED (never deleted)
```

- Drafts and flagged items never appear in reports. Reports have a toggle "include drafts" for preview only.
- The review queue is the daily/weekly working screen. It must be fast: keyboard navigation, inline edit of account/class, "apply to all similar" (same vendor & amount pattern), bulk Confirm of selected rows, and a "Confirm all AI-high-confidence rows from Jose-verified vendors" action.
- Every posted transaction shows its **source provenance** (statement line id, receipt id(s), who confirmed, AI vs. human classification, and the "Filled in by" style note the users already use).
- The receipt(s) attached to a transaction are shown as a clickable icon in the ledger row; clicking opens the receipt in a modal viewer (image or PDF) with the transaction summary alongside. Multiple receipts per transaction and one receipt covering several transactions are both allowed.

## Receipts and the AI classifier

- Upload: images (JPG/PNG/HEIC→convert) and PDFs, single or bulk, drag-and-drop and mobile camera. Files go to DigitalOcean Spaces (private bucket, server-side encryption, signed URLs only). Store a SHA-256 of every file; identical uploads are detected and linked, not duplicated.
- Extraction: call the Claude API (`claude-sonnet-5` by default; model id and monthly spend cap are Settings) with the image/PDF and a structured prompt that includes the **active chart of accounts, active classes, vendor memory, and the house rules** below. Ask for strict JSON: `vendor, date, total, tax, line_items[], payment_method_last4, proposed_account, proposed_class, confidence (0–1), reasoning (2–4 plain-English sentences), flags[]`. Use prompt caching for the static part of the prompt. Validate the JSON; on failure retry once, then flag.
- **Vendor memory first, AI second.** Before asking the model, look up the vendor's history (2019–2025 imported data is a large, Jose-verified corpus). If a vendor has ≥ 3 prior postings with one dominant account+class (≥ 80 %), pre-fill from history and mark `source: vendor history`; still run the model if the receipt has line items that suggest a different account. Vendor aliases (e.g., "LOWES #02405" → Lowes) live in a `vendor_aliases` table the users can edit.
- House rules the prompt must carry (keep in `config/classification_rules.md`, editable by users in Settings → AI):
  - Meals not tied to a property or client → `5217` with class `General`, flagged for Jose's call (his stated catch-all rule).
  - Subscriptions that are personal (streaming, DashPass) → `3102 Capital Distribution`.
  - Amazon defaults to `5215 Supplies Expense` only when line items are unknown; if line items are visible, classify by content and note it.
  - Items ≥ $2,500 that are furniture/equipment/improvements → propose a capital asset account and flag "capitalize vs expense — Jose to decide".
  - Fuel: propose the allocation model for the year if the vendor is a gas station and the class is unclear.
  - Anything with confidence < 0.7 → `FLAGGED` with the reason in the system notes.
- Two notes fields on every draft/transaction: **System notes** (AI reasoning, matching results, model application — append-only, timestamped) and **User notes** (free text). Both searchable.
- Receipts uploaded before their statement arrives sit in the **Receipt inbox** (`pending_statement`) and are matched when the statement is uploaded. Receipts still unmatched 45 days after their date are flagged "no bank line found" (cash purchase? personal card? duplicate?).

## Bank statements and reconciliation

- Sources: Bank of America PDF statements for `1101` and `1103` (monthly). Venmo: CSV export or manual entry (decide in Phase 4).
- Parse deterministically first (text layer with `pdfjs-dist`/`pdf-parse`, then a BofA-specific line parser); fall back to Claude vision per page only if the text layer is missing. Store the statement (file, period, opening balance, closing balance) and its lines (date, description, amount, running balance if present).
- **Tie-out is the control:** opening balance + sum(lines) must equal closing balance or the statement is rejected with a clear message. The ledger's bank balance at period end must equal the statement closing balance once all lines are posted; show the difference prominently on the reconciliation screen.
- Duplicate detection on import: same account, date, amount, and normalized description → flag, never silently drop (the 2025 books contain legitimate same-day identical payments).
- Matching statement lines to receipts: amount exact (± tip/tax tolerance configurable, default $0), date within ± 5 days, vendor similarity. Show match confidence; users confirm. Lines with no receipt are normal (ACH, transfers, checks) — only flag "receipt expected" for vendor types the users mark as receipt-required (default: hardware stores, Amazon, restaurants, gas).
- Transfers between own accounts (SREI ↔ PLA, bank ↔ Venmo, Jose's personal account) are recognized by description patterns ("Online Banking transfer to CHK 1735") and pre-classified as `3101/3102` or inter-account transfer per Settings.
- Reconciliation screen per account per month: statement lines vs. ledger, matched/unmatched, receipts inbox, tie-out status, and a "Mark month reconciled" action (audit-logged).

## Allocation models (splits)

Purpose: replace one-off hardcoded splits with a consistent, versioned system per tax year. Reference: the "Tax Worksheet" tabs in the 2019–2024 workbook (see `DATA_SOURCES.md`). A model has:

1. **Scope:** one entity, one tax year. A tax year can have several models (e.g., "Chisel Creek grounds", "Truck fuel by rentals serviced", "Umbrella insurance", "1625 parcel taxes").
2. **Basis inputs:** a table of allocation targets with weights. Targets are classes, plus the special target **Personal** (posts to `3102 Capital Distribution`, class `General`). Weights can be manual %, property value, acreage, months in service, or "rentals serviced" counts. The model computes percentages from weights and shows them; totals must equal 100.00 % after rounding, with the rounding remainder assigned to a designated target (default: largest share).
3. **Rules (optional):** "auto-apply when account ∈ {…} and class = General and vendor matches …". Rules only create _proposals_; a human confirms. Manual application from the review queue or ledger row is always available ("Split using model → pick model").
4. **Versioning:** every save creates a new version with a diff and a note. A version applies to the whole tax year: **editing a model re-splits every transaction in that year that is linked to it**, drafts and posted alike. Before saving, show a preview: "This change re-splits N posted and M draft transactions from Jan 1 to today, moving $X between classes." Require confirmation. If the year is closed/filed, show the giant closed-year warning on top and require a typed reason. Any version can be reverted to.
5. **Linkage:** a split transaction keeps its parent line and stores `allocation_model_version_id` on the generated lines. Manual (non-model) splits store `null` and are untouched by model edits.
6. **Unsplit:** a transaction can be returned to a single line (e.g., the 91 rows unsplit back to `General` on 2026-09-10 are the first real use case once models exist).
7. **History:** 2020–2024 worksheet parameters are imported as archived, read-only "reference models" for documentation. They are **not** re-applied — those years' splits are already in the imported lines.
8. Cross-year consistency: a model never applies outside its tax year. Cloning a model into the next year is one click ("Copy to 2027, review weights").

## Reports, performance, export

- **Reports** (per entity, class filter, date range, comparison period, drill-down to transactions, print/PDF and Excel): Profit & Loss (by account, with class columns option), Balance Sheet, Cash Flow (cash-basis: operating / investing (property assets) / financing (contributions, distributions, deposits)), Trial Balance, General Ledger by account, Class P&L (one column per property — this is the sheet Jose reads), Vendor summary, Distributions & contributions, Fixed-asset additions, 1099-candidate vendors (services paid ≥ $600 in a year), Sole-proprietor pre-PLA report (2025), and the year-end "Reallocation of General expenses" view (what the model moved where).
- **Performance** tab: dashboard per entity and per property with month/quarter/year toggles — income vs. expense, net operating income per property, expense mix, cash balance over time, distributions vs. contributions, year-over-year comparisons, top vendors. Charts + tables, flip between report views. Recharts; consistent colors per property.
- **Tax export** (per entity per year, one click when the year is closed): an `.xlsx` with tabs — Summary, P&L by account, Class P&L (per property, Form 8825 layout for rentals), Balance Sheet, Fixed-asset additions, Contributions/Distributions, Allocation summary, Transaction detail (every posted line with receipt file names), Flags & overrides. Account-to-tax-line mapping (1065 page 1, Form 8825, Schedule C) lives in Settings → Tax mapping and is editable. Also export CSV of any table anywhere.
- **History** area: per entity, the list of years with state, exports generated (kept, dated), the filed return PDF(s), and the year's audit summary.

## Users, roles, security

- Auth: email + password (Argon2id) + **TOTP authenticator app** MFA (required for every user; recovery codes generated once and shown once). No SMS. Session cookies `HttpOnly; Secure; SameSite=Lax`, 12-hour idle expiry, "sign out everywhere". Rate-limit and lock out after repeated failures. Optional: allow-list of IPs in Settings.
- Roles: **Owner** (Jose; everything, incl. user management and year close), **Full access** (Jamin; everything except deleting users and changing the owner), **Limited** (a checklist of permissions: view ledger, upload receipts, review/confirm, edit posted, manage models, run reports, export, view settings, manage users), **View only**. Enforce on the server, not just in the UI.
- Settings → **Activity** tab: the audit log, filterable by user, action, entity, date; every login (success/fail), confirm, edit, void, split, model change, year-state change, export, settings change, user change. Immutable (append-only table; no update/delete grants for the app role).
- Secrets only in environment variables (`.env` never committed; `.env.example` always current). Anthropic API key, DB password, Spaces keys, TOTP encryption key.
- HTTPS everywhere (Caddy with automatic certificates). Postgres not exposed publicly. Firewall: 22 (key-only), 80, 443.
- Backups: nightly `pg_dump` to a private Spaces bucket, 30 daily + 12 monthly retained; documented restore drill. Receipts already live in Spaces; enable bucket versioning.
- Privacy: keep the raw source workbooks out of git (`data/source/` is git-ignored). Repo is private on GitHub.

## Tech stack (decided)

- **Next.js 15 (App Router) + TypeScript + React**, server actions/route handlers for the API. One language front to back.
- **PostgreSQL 16** with **Prisma** (schema + migrations). Constraints/triggers for the double-entry invariant and audit immutability written in SQL migrations.
- **Tailwind CSS + shadcn/ui** components, **Recharts** for charts, **TanStack Table** for the data grids, `react-hook-form` + `zod` for forms and validation (shared zod schemas between client and server).
- **Files:** DigitalOcean Spaces via the AWS S3 SDK. **Excel:** `exceljs` (export) and `xlsx`/SheetJS or `exceljs` (import scripts). **PDF:** `pdfjs-dist` for text extraction, `sharp` for image handling.
- **AI:** `@anthropic-ai/sdk`, default model `claude-sonnet-5`, JSON-schema-validated responses, prompt caching, per-call cost recorded in an `ai_usage` table shown in Settings → AI.
- **Auth:** custom session auth (or Auth.js credentials provider) + `otplib` for TOTP. Keep it simple and auditable.
- **Tests:** Vitest for the accounting core (balancing, allocation math, rounding, lock enforcement, import reconciliation totals) — these must pass before any phase ends. Playwright smoke test for login → review → confirm → ledger.
- **Deploy:** Docker Compose (app, postgres, caddy) on one DigitalOcean Droplet (2 GB is enough to start); GitHub Actions builds and deploys on push to `main` (Phase 7). `docs/HOW_TO_RUN.md` explains local dev and deploy in plain English.
- Node 22 LTS. `pnpm`. Prettier + ESLint. Conventional commits.

## UI direction

"Clean and sleek, like a professional financial tool." Concretely:

- Calm neutral palette (graphite/slate greys, white surfaces) with **one** accent color for actions; muted green/red only for money direction and status. No gradients, no decorative illustrations, no marketing-page feel.
- Dense but breathable tables: tabular (monospaced) numerals, right-aligned amounts, thousands separators, negative in parentheses or red per user setting, sticky headers, column filters, saved views. Row height compact by default.
- Left sidebar navigation: Dashboard · Review (with count badge) · Ledger · Receipts · Statements · Reports · Performance · Tax Years / History · Settings. Entity switcher and tax-year picker in the top bar; both persist.
- Status chips: Draft / Flagged / Posted / Voided; year badges Open / Closed / Filed; AI-vs-human classification indicator (the green "from Jose" marker the users already know).
- Keyboard-first review queue (j/k move, e edit, c confirm, s split, f flag). Confirmations for destructive or irreversible actions are modals with the consequence stated in one sentence and a typed-reason field where this file requires it.
- Every screen has an obvious empty state and a one-line "what to do here" helper. Consistent Inter (or system) typeface, 8-px spacing scale, dark mode optional later, mobile-usable for receipt upload and review.

## Engineering rules

1. Read `docs/PROGRESS.md` first; write to it last. It is the hand-off between sessions.
2. Small, frequent commits with plain-English messages. Push to GitHub at the end of every phase (and before any risky migration).
3. Migrations are additive and reversible where possible; never write a migration that drops data. Seed and import scripts are idempotent (safe to re-run).
4. Ask before anything destructive (dropping tables, deleting files, force-pushing, changing auth). Otherwise, decide and proceed — do not stall on questions you can answer with a sensible default; record the default in `docs/DECISIONS.md`.
5. Do not add frameworks, ORMs, or UI libraries beyond the decided stack. Fewer dependencies, pinned versions.
6. Every accounting behavior gets a test before the phase ends. The invariant suite (`pnpm test:core`) must be green at every commit.
7. Plain-English summaries: end every phase with `docs/PROGRESS.md` updated (done / how to try it / what's next / questions for Jose & Jamin), and tell Jamin in the chat, in non-technical language, what changed and what he should click to verify.
8. Never log secrets, full bank descriptions with account numbers, or receipt contents at info level.
9. Keep `docs/HOW_TO_RUN.md` and `.env.example` current whenever setup changes.

## Phases (each is its own Claude Code session — see KICKOFF_PROMPTS.md)

0. Orientation, design doc, scaffold, auth + MFA + roles + audit log, app shell.
1. Core ledger: entities, bank accounts, chart of accounts, classes, journal entries, ledger views, manual entries and splits, tax years with locking, receipt viewer.
2. Historical import: 2019–2024 (double-entry) and 2025 (single-line snapshot), reconciled to the workbook totals; reference models archived.
3. Receipts + AI classifier + review queue.
4. Bank statements, matching, reconciliation, tie-out.
5. Allocation models (builder, versions, retroactive re-apply, warnings, manual splits, unsplit).
6. Reports, performance dashboard, year-end close, tax export, History area, tax-line mapping.
7. Hardening, backups, deployment to DigitalOcean, GitHub Actions, runbook, polish.

## Open decisions (defaults in force until Jose/Jamin say otherwise)

| #   | Decision                                                                                  | Default                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | PLA tax treatment and form (Schedule C vs 1120-S)                                         | Build the export generic (P&L by account + mapping table); map to Schedule C until told otherwise                                                |
| D2  | PLA launch date (for the sole-proprietor pre-PLA report)                                  | Use 2025-06-02 (bank account opening) as placeholder; mark clearly as placeholder                                                                |
| D3  | Cross-entity payments bridge                                                              | Distribution / contribution (see Accounting model)                                                                                               |
| D4  | Venmo                                                                                     | Treated as a bank-type account `1104 Venmo` on SREI; lines entered manually or via CSV until a better source exists                              |
| D5  | Duplicate `1501 Tenant Rent Due` in the source chart (listed as both Asset and Liability) | Keep one Asset account `1501`; note it in DECISIONS                                                                                              |
| D6  | Depreciation                                                                              | Booked as year-end adjusting journal entries from TurboTax's schedule; a fixed-asset register with straight-line preview is Phase 6 nice-to-have |
| D7  | Wages                                                                                     | Source books record net pay; add fields/notes so gross vs. net can be reconciled from Alison's payroll register at year end                      |
| D8  | Existing "live app" / "shared ledger" referenced in the 2025 snapshot                     | If one exists, ask Jamin for its data export and treat that as the source of truth; otherwise import the snapshot                                |
| D9  | Receipt-required vendor types                                                             | Hardware stores, Amazon, restaurants, gas stations, contractors                                                                                  |
| D10 | Year-end model re-application on a **filed** year                                         | Allowed only by Owner with typed reason; export a before/after diff automatically                                                                |
