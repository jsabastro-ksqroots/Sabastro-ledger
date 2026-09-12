# PROGRESS.md — session hand-off

Read this after `CLAUDE.md` at the start of every session. Write to it last.

## Where we are

**Phase 0 (orientation, design, scaffold, auth, app shell) — DONE on 2026-09-12**, except the push to
GitHub, which needs a human to create the repository first (see "Blocked").

Next session: **Phase 1 — core ledger.** Paste the Phase 1 prompt from `KICKOFF_PROMPTS.md`.

## Done in Phase 0

- **Workbooks verified** against `DATA_SOURCES.md` with openpyxl. Five count discrepancies found and
  documented in `docs/WORKBOOK_VERIFICATION.md` (7,144 lines not 7,090; the pivot is 2024-only; 93 not
  91 unsplit rows; two trailer rows; 1,781 blank names); `DATA_SOURCES.md` corrected in place with a
  banner. Money totals all tie.
- **Design docs:** `docs/DESIGN.md` (data model, lifecycle, attribution + bridge rule, tax-year lock,
  model versioning, security, 5 questions for Jamin), `docs/DECISIONS.md` (D1–D10 defaults adopted and
  P0-1…P0-31), `docs/HOW_TO_RUN.md` (plain English). DESIGN.md went through an independent 4-lens
  adversarial review (53 agents); 28 confirmed findings were folded in (superseded lines instead of
  deletes, general bridge rule, bank-line attribution, lock trigger over every entity in a transaction,
  half-open sessions, user-management ladder, statement/model schema fixes, seed fixes).
- **Repo scaffold:** Next.js 15.5 (App Router) + TypeScript 5.9, Tailwind 4 + shadcn/ui, Prisma 7 +
  Postgres 16 (Docker Compose, plus an embedded-Postgres fallback for machines without Docker), Vitest 5,
  Playwright 1.63, ESLint 9 + Prettier, pnpm 12, Makefile, `.env.example`, `.gitignore` (ignores `.env`
  and `data/source/`).
- **Schema + first migration** (`prisma/migrations/20260912000000_init`): users, user_permissions,
  recovery_codes, sessions, login_attempts, audit_log, entities, accounts, bank_accounts, classes,
  entity_bridge_rules, tax_years, settings. Hand-written SQL: restricted `ledger_app` role and grants
  (audit_log and login_attempts append-only; no user deletes; migrations table hidden), audit
  immutability trigger (blocks even the owner, incl. TRUNCATE), single-active-Owner index,
  owner-protection trigger, bank-account-type trigger, tax-year forward-only trigger with the
  `app.lock_override_reason` override mechanism that Phase 1 extends to transactions.
- **Auth:** Argon2id passwords (12+ chars policy), TOTP MFA via otplib 13 with QR enrollment, manual
  key, ten one-time recovery codes, replay protection (last time step stored), AES-256-GCM encrypted
  secrets, forced enrollment on first login, half-open sessions (10 min) with token rotation after MFA,
  12 h idle / 7 d absolute sessions, sign out / sign out everywhere, lockout after 5 failures (password,
  code, or recovery code; doubling lock, max 24 h), per-IP throttle (only with trusted proxy headers),
  four roles + Limited checklist (now incl. `close_year`), user-management ladder (P0-20), server-side
  guards in every action, page and route handler.
- **Seed** (`pnpm db:seed`): idempotent; 2 entities, 76 accounts, 4 bank accounts, 13 classes (2
  inactive), 2 bridge rules, 8 tax years (SREI 2019–2024 filed, 2025 open; PLA 2025 open), 4 settings,
  the two users from `.env`. `seed/classes.csv` gained an `is_shared` column; `1501` sub-types fixed.
- **App shell:** dark sidebar with every section (Review badge wired to 0), entity switcher + tax-year
  picker in the top bar (persisted in cookies), user menu (sign out / sign out everywhere), dashboard,
  Tax Years list, placeholder pages for Phase 1–6 sections.
- **Settings:** Users (my account: change password, new recovery codes, sign out everywhere; add / edit /
  set temporary password / reset MFA / unlock / remove / change owner, all ladder-gated), Activity
  (filterable, expandable before/after, CSV export that is itself audited), Entities & bank accounts
  (edit entities, add/edit/deactivate bank accounts incl. creating the ledger account, bridge rules),
  Chart of accounts (grouped, search, show inactive, add/edit/deactivate, "confirm with Jose" markers on
  the five inferred accounts), Classes (add/edit/deactivate, General protected).
- **Checks (all green on 2026-09-12):** `pnpm typecheck`, `pnpm lint`, `pnpm test` = 10 files / 66
  tests (money helpers, auth flows, lockout, MFA, sessions, permissions, audit immutability, owner
  protection, tax-year rule, seed idempotency, user rules, activity queries, entities, accounts,
  classes), `pnpm build` (20 routes), Playwright smoke test `tests/e2e/smoke.spec.ts` (see the line in
  the commit message for its result), and a manual browser walk-through of sign-in → enrol → dashboard
  → switchers → every Settings tab.

## How to try it

On this Mac (no Docker): `pnpm dev:nodocker`, then open the printed localhost address (port 3000 is
occupied by another program here, so the dev preview picks a free port). Logins are in `.env`
(`SEED_OWNER_*` = Jose, `SEED_FULL_*` = Jamin; Jamin's account already has an authenticator enrolled from
the walk-through — use "Reset authenticator" as Jose, or `pnpm db:recreate`, to start clean).
Anywhere else: follow `docs/HOW_TO_RUN.md`.

## Blocked / needs a human

- **GitHub push.** No repository exists and there is no `gh` CLI or token here. The SSH key on this Mac
  belongs to the GitHub account `jsabastro-ksqroots`. Create a **private** repository named
  `sabastro-ledger` under that account (github.com → New repository → Private, no README), then in the
  project folder run:

  ```bash
  git push -u origin main
  ```

  (the remote is already configured). If the repo should live under a different account, run
  `git remote set-url origin git@github.com:<account>/sabastro-ledger.git` first.
- **Docker Desktop** is not installed on this Mac (needs an admin password); the embedded Postgres
  fallback is used instead. `docs/HOW_TO_RUN.md` section 1 explains the normal install.
- The project folder sits inside Google Drive; moving it to `~/Projects/sabastro-ledger` is recommended.

## Questions for Jose & Jamin (defaults in force meanwhile)

The five questions at the end of `docs/DESIGN.md`: PLA launch date (D2), PLA tax form (D1), the old
"live app" (D8), seed confirmations (1104 Venmo, five inferred accounts, 1501 as a receivable), sign-in
emails + which GitHub account.

## Known gaps / notes for later phases

- The IP allow-list and `TRUST_PROXY_HEADERS` are wired in code but the allow-list UI arrives with
  deployment (Phase 7).
- Settings tabs AI, Models, Tax mapping, Data are greyed placeholders (Phases 3, 5, 6, 2).
- `listUsers` counts unrevoked sessions including expired ones; the Users page computes live sessions
  separately (note from the Users tab build).
- Dev-only quirk: Prisma refuses `migrate reset` when run by an AI agent; use `pnpm db:recreate`.

## What's next (Phase 1 — core ledger)

Transactions + transaction_lines with the per-entity balance trigger over live lines (DESIGN §1–§3,
P0-21), simple-row entry, manual journals (adjusting), manual splits/unsplit via superseded lines, the
general bridge rule (P0-24), the tax-year lock trigger on transactions/lines (P0-22), ledger grid,
system/user notes, and the tests listed in the Phase 1 prompt.
