# KICKOFF_PROMPTS.md — how to run this build in Claude Code

## Before the first session (one-time, ~15 minutes)

1. Create a **private** GitHub repository named `sabastro-ledger` and clone it to your Mac (or create the folder and let Claude Code initialize git and push).
2. Copy into the repo root: `CLAUDE.md`, `DATA_SOURCES.md`, `KICKOFF_PROMPTS.md`, the `seed/` folder, and the `data/source/` folder (the two renamed workbooks). `data/source/` must be git-ignored; Phase 0 sets that up.
3. Have ready (Claude Code will ask): an Anthropic API key with a few dollars of credit (Phase 3), DigitalOcean Spaces keys and bucket name (Phase 3), and a Droplet (Phase 7). Nothing is needed for Phases 0–2 beyond Docker Desktop on the Mac.
4. Start Claude Code in the repo folder. Use the highest effort/thinking setting you have. Paste the Phase 0 prompt.

## Session rules (this is what keeps you from running out of context mid-build)

- **One phase per session.** When a phase ends, commit, push, then `/clear` (or start a fresh session) before the next phase.
- Every phase prompt starts with "Read CLAUDE.md and docs/PROGRESS.md" — that is how the fresh session picks up where the last one left off. Do not skip it.
- If a session feels long or slow, paste the **Checkpoint** prompt below; it writes a resume point to `docs/PROGRESS.md`. Then `/clear` and paste the **Resume** prompt.
- If Claude Code asks a question you can't answer, say "use the default from CLAUDE.md's Open decisions table and record it in docs/DECISIONS.md" — don't let it stall.
- Ask for plain English whenever something is unclear: "explain that like I've never used a terminal."

---

## Checkpoint (paste any time a session is getting long)

```
Stop and checkpoint. Update docs/PROGRESS.md with: (1) exactly what is done in this phase, (2) what is half-done and the next concrete step, (3) any decisions you made and why, (4) commands to run to see the current state. Run the core tests, commit everything with a clear message, push, and then tell me in two sentences where we are. I will start a fresh session and resume from PROGRESS.md.
```

## Resume (paste at the start of a fresh session mid-phase)

```
Read CLAUDE.md and docs/PROGRESS.md. We are in the middle of the phase named there. Confirm in three lines what you will do next, then continue from the resume point. Do not redo finished work.
```

---

## Phase 0 — Orientation, design, scaffold, auth

```
Read CLAUDE.md, DATA_SOURCES.md, and seed/*.csv in full before doing anything. Then open both workbooks in data/source/ with Python (openpyxl, read_only=True, data_only=True) and confirm the counts stated in DATA_SOURCES.md. Report any discrepancy before proceeding.

This is Phase 0 of the build described in CLAUDE.md. Goals for this session:

1. Write docs/DESIGN.md: the data model as a table list with key fields and relationships (entities, bank_accounts, accounts, classes, tax_years, transactions, transaction_lines, receipts, receipt_links, statements, statement_lines, allocation_models, allocation_model_versions, allocation_targets, allocation_rules, users, roles/permissions, sessions, audit_log, ai_usage, vendor_aliases, vendor_memory, notes), the transaction lifecycle, the entity-attribution and cross-entity bridge rule, the tax-year lock rule, and the allocation-model versioning rule — each in one or two paragraphs of plain English plus the constraints you will enforce in the database. Keep it under 6 pages. Ask me at most five questions at the end of the doc; for everything else use the defaults in CLAUDE.md's Open decisions table and record them in docs/DECISIONS.md.
2. Write docs/PROGRESS.md (the session hand-off file) and docs/HOW_TO_RUN.md (plain English: install Docker Desktop, start the app locally, log in, run tests).
3. Scaffold the repo with the decided stack: Next.js 15 + TypeScript, Tailwind + shadcn/ui, Prisma + Postgres 16 via Docker Compose for local dev, Vitest, Playwright, ESLint/Prettier, pnpm. Add .gitignore (must ignore .env and data/source/), .env.example, and a Makefile or pnpm scripts for the common commands.
4. Implement the Prisma schema for users, roles/permissions, sessions, audit_log, entities, bank_accounts, accounts, classes, tax_years. Add the SQL migration pieces for an append-only audit_log (no UPDATE/DELETE for the app database role).
5. Implement authentication: email + password (Argon2id), TOTP MFA with QR enrollment and recovery codes (otplib), rate limiting, secure session cookies, sign-out-everywhere, and the four roles with a permissions checklist for Limited users. Seed two users (Jose = Owner, Jamin = Full access) from environment variables with a forced MFA enrollment on first login. Enforce permissions server-side.
6. Build the app shell to the UI direction in CLAUDE.md: sidebar navigation with all sections (placeholder pages are fine), entity switcher and tax-year picker in the top bar, a Settings area with Users, Activity (the audit log, filterable), Entities & bank accounts, Chart of accounts, Classes tabs — the last three populated from the seed CSVs with add/edit/deactivate.
7. Tests: auth (login, MFA, lockout, permission denial), audit immutability, seed idempotency.

Definition of done: I can run one command, open the app locally, enroll MFA, log in as either user, see the shell, browse the chart of accounts and classes, see my login in the Activity tab, and all tests pass. Finish by updating docs/PROGRESS.md, committing and pushing, and telling me in plain English what to click to verify. Then stop; Phase 1 will be a new session.
```

## Phase 1 — Core ledger

```
Read CLAUDE.md and docs/PROGRESS.md. This is Phase 1: the core ledger. Do not start on imports, receipts, or AI yet.

Build:
1. Journal entries: transactions + transaction_lines with the double-entry invariant enforced in the app and by a database trigger (sum of debits = sum of credits per transaction, amounts in integer cents, at least two lines, every line has an account and a class). Statuses draft / flagged / posted / voided; void requires a reason; nothing is ever deleted.
2. The "simple row" abstraction: create/edit a bank-centric transaction as date, vendor, amount (signed), account, class, bank account, memo, notes, and have the system produce the two lines per the rule in DATA_SOURCES.md. A "journal view" toggle shows the raw lines. A manual journal entry form (multi-line, flagged as adjusting) for depreciation and year-end entries.
3. Manual splits: split any transaction into several account/class lines that must sum to the original; unsplit back to one line. Both from the ledger row and (later) the review queue — build the component once.
4. Entity attribution and the cross-entity bridge rule from CLAUDE.md, configurable per entity pair in Settings.
5. Tax years per entity with open / closed / filed states; the closed/filed override flow (full-screen warning, typed reason, audit override record, badge in reports); year-end checklist skeleton (items can be stubbed, the gate must work).
6. Ledger screen: fast data grid (TanStack Table) with entity and year scoping, column filters, search across vendor/memo/notes, sorting, saved views, totals footer, status chips, provenance popover, receipt icon that opens a modal viewer (wire the viewer to a placeholder now; Phase 3 connects real files), inline edit of account/class with audit trail, keyboard shortcuts.
7. System notes (append-only, timestamped) and user notes on every transaction; both searchable.
8. Tests: balancing trigger, split math and rounding, lock enforcement, bridge entries balance per entity, void behavior.

Definition of done: I can create, edit, split, unsplit, and void transactions on both entities; a cross-entity payment shows correctly on each entity; closing a year blocks edits behind the warning; the Activity tab shows every action; tests pass. Update docs/PROGRESS.md, commit, push, and explain what to click. Stop there.
```

## Phase 2 — Historical import (2019–2024 and 2025)

```
Read CLAUDE.md, docs/PROGRESS.md, and DATA_SOURCES.md in full. This is Phase 2: import the historical books. Write import scripts under scripts/import/ (TypeScript or Python — your choice, but document how to run them in docs/HOW_TO_RUN.md).

1. Import Workbook A (2019–2024) as double-entry transactions exactly as they are, grouped by cached Transaction #, with account numbers parsed from the "NNNN Name" strings and classes mapped to the seed. Preserve Name, Memo, and the source row numbers as provenance. Do not "improve" the historical classifications.
2. Import Workbook B (2025) using the single-row → two-line rule in DATA_SOURCES.md, applying the bridge rule for cross-entity rows only after listing them in the report, and handling every quirk listed there (the split row as a flagged draft; identical same-day rows kept; unsplit rows tagged needs_model_split; notes into System notes / User notes; "Filled in by" into provenance with verified_by_owner).
3. Reconcile: reproduce every number in the DATA_SOURCES.md acceptance checklist and write docs/IMPORT_REPORT.md. If anything does not tie to the cent, stop and show me the difference rather than forcing it.
4. Set 2019–2024 tax years to filed and 2025 to open for SREI; PLA gets 2025 open only.
5. Import the 2020–2024 Tax Worksheet parameters (property values, acres, percentage sets, specific-bill totals) as archived, read-only reference models with a note describing the year's method. Do not apply them.
6. Make the import idempotent (unique key on source file + source row) and add a "Re-run import" admin command that is safe.
7. Add a Settings → Data tab that shows what was imported, when, and links to the import report.

Definition of done: the ledger shows six filed years and an open 2025 for SREI, PLA's 2025, totals match the checklist, the report is written, running the import again is a no-op, tests pass. Update docs/PROGRESS.md, commit, push, explain in plain English. Stop.
```

## Phase 3 — Receipts, AI classifier, review queue

```
Read CLAUDE.md and docs/PROGRESS.md. This is Phase 3: receipts and the AI-assisted review workflow. I will give you an Anthropic API key and DigitalOcean Spaces credentials for .env when you ask; never commit them.

1. Receipt upload (drag-and-drop, multi-file, mobile camera; JPG/PNG/HEIC/PDF) to a private Spaces bucket with server-side encryption, SHA-256 dedupe, signed URLs, and a thumbnail. Receipt inbox with statuses pending_statement / matched / flagged / archived.
2. Vendor memory built from the imported 2019–2025 lines (vendor → account/class frequency, verified-by-owner weighting) plus a user-editable vendor_aliases table.
3. The classifier: an Anthropic SDK call (model from Settings, default claude-sonnet-5) with prompt caching, the house rules from config/classification_rules.md (create it from the list in CLAUDE.md and make it editable in Settings → AI), the active chart of accounts and classes, and the vendor memory for that vendor. Strict JSON output validated with zod; one retry; then flag. Store reasoning in System notes, confidence on the draft, and cost per call in ai_usage (show monthly totals and a spend cap in Settings → AI; stop calling the API when the cap is hit and say so in the UI).
4. Drafts: each receipt produces a draft transaction (or attaches to an existing statement line if one already matches). Flag rules from CLAUDE.md (confidence < 0.7, capitalize-vs-expense, meals with no property, personal subscriptions, duplicates).
5. Review queue: the keyboard-first screen described in CLAUDE.md — filters (entity, status, source, confidence, vendor, date), inline edit, "apply to all similar", split via model or manual (reuse the Phase 1 component; model option greys out until Phase 5), bulk Confirm, "Confirm all high-confidence from verified vendors", flag/unflag with reason. Confirm posts the transaction and is audit-logged.
6. Receipt viewer modal from the ledger and the queue: image/PDF viewer with zoom, the transaction summary alongside, and the AI reasoning.
7. Tests: JSON validation, vendor-memory precedence over AI, flag rules, spend cap, dedupe.

Definition of done: I upload a stack of receipts, see drafts with sensible proposals and reasons, fix a couple, confirm the rest in bulk, and see them in the ledger with a clickable receipt. Update docs/PROGRESS.md, commit, push, explain. Stop.
```

## Phase 4 — Bank statements, matching, reconciliation

```
Read CLAUDE.md and docs/PROGRESS.md. This is Phase 4: bank statements and reconciliation. Ask me for two or three sample Bank of America PDF statements (one per account) and a Venmo export before you write the parser; build the parser against real files, not guesses.

1. Statement upload and parsing: text-layer extraction with pdfjs-dist, a BofA-specific line parser (date, description, amount, running balance, section), page-level Claude vision fallback only when no text layer exists. Store statements (account, period, opening/closing balance, file) and statement_lines.
2. Tie-out: opening + sum(lines) must equal closing or the statement is rejected with a clear message. Show the ledger-vs-statement difference on the reconciliation screen.
3. Each statement line becomes a draft (or matches an existing draft/receipt): matching by amount, date window (±5 days), vendor similarity; confidence shown; duplicates flagged never dropped; transfer patterns pre-classified per Settings; vendor memory + AI classification (Phase 3) for lines without receipts.
4. Missing-receipt flags for receipt-required vendor types (Settings list), receipts with no bank line after 45 days flagged, and an "unmatched" panel on both sides.
5. Reconciliation screen per account per month: statement lines vs. ledger, matched/unmatched, receipt inbox, tie-out status, "Mark month reconciled" (audit-logged), and a monthly reconciliation history.
6. Venmo: CSV import (from the sample) with the same lifecycle, plus manual entry.
7. Tests: parser on the sample files, tie-out math, matching precedence, duplicate flagging.

Definition of done: I upload a month's statement for each account, everything either matches a receipt or becomes a draft with a proposal, the month ties out to the cent, and I can mark it reconciled. Update docs/PROGRESS.md, commit, push, explain. Stop.
```

## Phase 5 — Allocation models

```
Read CLAUDE.md (the Allocation models section twice) and docs/PROGRESS.md. This is Phase 5: the model system that replaces hardcoded splits.

1. Models tab in Settings (and a quick link from the review queue and ledger): create/edit models per entity per tax year with name, description, basis inputs table (targets = classes plus the special Personal target that posts to 3102 Capital Distribution; weights as manual %, value, acres, months, or counts), computed percentages that must total 100.00 % with a designated remainder target, optional auto-apply rules (account set + class + vendor pattern → proposal only), and a "copy to next year" action. Show the archived 2020–2024 reference models read-only for comparison.
2. Versioning: every save is a new version with diff and note; versions listed with revert. Before saving a change that affects existing splits, show the preview from CLAUDE.md ("re-splits N posted and M draft transactions, moving $X between classes") and require confirmation; on a closed or filed year add the giant warning with a typed reason (Owner only for filed years; auto-export a before/after diff).
3. Application: "Split using model" from a draft or a posted transaction generates lines linked to the model version; rounding remainder rule; manual splits stay unlinked; unsplit works for both. Retroactive re-application on model edit recomputes every linked transaction in that year.
4. Work through the 91 needs_model_split rows from 2025 with me: propose one or more 2025 models from the 2024 worksheet parameters (as drafts for Jose to confirm), show me the preview, and do not apply until I say so.
5. Reports hook: an "Allocation summary" view per model version (what moved from which class to which, by account).
6. Tests: percentage math and rounding to the cent, version re-application idempotency, locked-year enforcement, manual splits untouched by model edits.

Definition of done: I can build a 2026 model, apply it to a fuel transaction, edit the model in June and watch every linked January–June transaction re-split with a warning first, revert a version, and see the allocation summary. Update docs/PROGRESS.md, commit, push, explain. Stop.
```

## Phase 6 — Reports, performance, year-end close, tax export

```
Read CLAUDE.md and docs/PROGRESS.md. This is Phase 6: reports, the performance dashboard, closing a year, and the export.

1. Reports listed in CLAUDE.md, each per entity with class filter, date range, comparison period, drill-down to transactions, print/PDF and Excel export: P&L, Balance Sheet, Cash Flow (cash-basis sections), Trial Balance, General Ledger by account, Class P&L (one column per property), Vendor summary, Contributions & distributions, Fixed-asset additions, 1099 candidates, Sole-proprietor pre-PLA (2025, using the launch date from Settings), Reallocation of General expenses (per model version). Validate the 2024 Class P&L against the workbook pivot in a test.
2. Performance tab: dashboards per entity and per property with month/quarter/year toggles — income vs. expense, NOI per property, expense mix, cash balance over time, distributions vs. contributions, YoY, top vendors; consistent colors per property; every chart has a table view and a "flip to next report" control.
3. Year-end close: the checklist gate (bank months reconciled, no drafts/flags, model applied, adjusting entries booked, export generated), Mark closed / Mark filed with the filed-return PDF and supporting documents attached, and the History area listing years, exports, returns, overrides.
4. Tax export: the one-click .xlsx per entity per year with the tabs listed in CLAUDE.md, driven by an editable account-to-tax-line mapping in Settings (1065 page 1, Form 8825 per property, Schedule C default for PLA). Keep every generated export with a timestamp.
5. Depreciation helper: a manual adjusting-entry template that takes TurboTax's schedule per asset class and books it; optional fixed-asset register with straight-line preview if time allows.
6. Tests: report totals against imported data, export tab contents, close gate.

Definition of done: for SREI 2024 I can open every report and they match the workbook; for 2025 I can walk the checklist, generate the export, mark the year closed and then filed with the return attached, and find it all in History. Update docs/PROGRESS.md, commit, push, explain. Stop.
```

## Phase 7 — Hardening and deployment

```
Read CLAUDE.md and docs/PROGRESS.md. This is Phase 7: make it safe and put it on the internet. Assume I am not technical; every step I must do myself goes in docs/DEPLOY.md with exact clicks and commands.

1. Security review of the whole app against CLAUDE.md's Users, roles, security section: server-side permission checks on every route, CSRF, headers (CSP, HSTS), input validation, signed URLs, secret handling, dependency audit. Fix what you find; list what you changed.
2. Production Docker Compose: app, Postgres 16 with a persistent volume, Caddy with automatic HTTPS for the domain I give you; firewall rules; non-root containers; log rotation.
3. Backups: nightly pg_dump to a private Spaces bucket with 30 daily + 12 monthly retention, bucket versioning on the receipts bucket, and a tested restore procedure documented in plain English (do a real restore into a scratch database and show me).
4. GitHub Actions: on push to main, run tests, build the image, deploy to the Droplet over SSH; a manual "rollback to previous image" workflow.
5. Operations: health endpoint, uptime check instructions, error reporting to a log the users can read in Settings → System, disk/DB size shown there, "export everything" (full data + files) button for the Owner.
6. Polish pass on the UI direction: empty states, loading states, mobile receipt upload, consistent number formatting, dark mode if cheap.
7. docs/RUNBOOK.md: monthly routine (upload statements, review, reconcile), yearly routine (models, adjusting entries, close, export, file, attach return), how to add a user, how to restore a backup, what to do if the AI spend cap trips.

Definition of done: the app is reachable over HTTPS on our domain, both of us can log in with MFA from our phones, a backup ran and a restore was demonstrated, a push to main deploys, and the runbook exists. Update docs/PROGRESS.md, commit, push, explain. Stop.
```

---

## After Phase 7

Use short, single-purpose sessions from here on ("Read CLAUDE.md and docs/PROGRESS.md, then: …"). Keep CLAUDE.md as the source of truth: when a decision changes, change it there first.
