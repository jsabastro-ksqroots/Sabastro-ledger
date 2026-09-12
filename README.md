# Sabastro Ledger

Private, login-protected bookkeeping app for Sabastro Real Estate Investments LLC and Providence Legacy Advisors LLC.

- **To run it:** `docs/HOW_TO_RUN.md` (plain English).
- **Where the build stands:** `docs/PROGRESS.md`. Design: `docs/DESIGN.md`; decisions: `docs/DECISIONS.md`.
- **How the build is run:** `CLAUDE.md` (project constitution) and `KICKOFF_PROMPTS.md` (one prompt per phase).

## Kickoff bundle (original notes)

| File / folder                | What it is                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                  | The project constitution. Claude Code reads it at the start of every session. Change decisions here first.                                         |
| `KICKOFF_PROMPTS.md`         | Setup steps, session rules, and the eight phase prompts to paste one per session.                                                                  |
| `DATA_SOURCES.md`            | Exact structure of the two workbooks, verified counts, quirks, and the import acceptance checklist.                                                |
| `seed/chart_of_accounts.csv` | 76 accounts: the 2019–2024 chart, cleaned, plus the five accounts introduced in 2025 and a proposed Venmo account (flagged for confirmation).      |
| `seed/classes.csv`           | The 13 classes with entity, legal-entity note, and active years.                                                                                   |
| `data/source/`               | The two workbooks, renamed date-first. **Git-ignored** — keep them here on your Mac and on the server for the one-time import; do not commit them. |

Things still worth gathering before Phase 3–6 (none block Phases 0–2):

- Which forms each entity files (PLA especially), and PLA's launch date.
- The 2025 depreciation schedule from TurboTax.
- Two or three Bank of America statement PDFs (one per account) and a Venmo export, for Phase 4.
- A folder of the 2025 receipts that the snapshot says exist (121 rows reference them).
- Whether the "live app / shared ledger" that produced the 2025 snapshot still exists and can export its data.
