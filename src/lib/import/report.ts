import type { Check } from "./types";

/**
 * The import report (docs/IMPORT_REPORT.md and Settings → Data), rendered from the JSON summary the
 * import run stores. Plain Markdown: headings, tables, lists.
 */

export interface ImportSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  dryRun: boolean;
  trigger: string;
  actorName: string;
  outcome: "SUCCEEDED" | "FAILED" | "DRY_RUN";
  error: string | null;
  sources: { key: "A" | "B"; file: string; path: string; sha256: string; bytes: number }[];
  extraction: {
    a: {
      lines: number;
      entries: number;
      linesWithAmounts: number;
      firstDate: string;
      lastDate: string;
      kindsByYear: Record<string, Record<string, number>>;
      transfers: number[];
      mixedDates: { txn: number; dates: string[] }[];
      normalised: {
        txn: number;
        row: number;
        account: string;
        class: string;
        raw: string;
        storedAs: string;
      }[];
      zeroEntries: number[];
      formulaCellsWithoutCachedResult: number;
      subCentAmounts: number;
      entriesWithoutName: number;
    };
    b: {
      rows: number;
      stoppedAtRow: number | null;
      firstDate: string;
      lastDate: string;
      byBank: Record<string, number>;
      byClass: Record<string, number>;
      unsplit: { count: number; net: string; byClass: Record<string, number> };
      joseRows: number;
      receiptRows: number;
      receiptFiles: number;
      questionsForJose: {
        number: string;
        group: string;
        question: string;
        amount: string;
        date: string;
        why: string;
      }[];
    };
  };
  checks: { preA: Check[]; preB: Check[]; models: Check[]; db: Check[] };
  load: {
    a: { existing: number; inserted: number };
    b: { existing: number; inserted: number };
    models: { existing: number; inserted: number };
    lockedYearsTouched: string[];
  };
  crossEntity: {
    providenceOn1101: {
      ref: number;
      date: string;
      vendor: string;
      amount: string;
      account: string;
      beforeLaunch: boolean;
    }[];
    generalOn1103: { ref: number; date: string; vendor: string; amount: string; account: string }[];
    other: {
      ref: number;
      date: string;
      vendor: string;
      amount: string;
      account: string;
      class: string;
      bank: string;
    }[];
    plaLaunchPlaceholder: string;
  };
  attention: { title: string; items: string[] }[];
  chartDiff: { inWorkbookNotSeed: string[]; inSeedNotWorkbook: string[]; differences: string[] };
  referenceModels: {
    year: number;
    sheet: string;
    method: string;
    verified: { checked: number; mismatches: string[] };
    models: {
      name: string;
      key: string;
      basis: string;
      secondaryBasis: string | null;
      description: string;
      targets: {
        label: string;
        target: string;
        weight: number;
        weight2: number | null;
        share: number;
        bp: number;
        remainder: boolean;
      }[];
      problems: string[];
    }[];
    bills: { label: string; total: number; setKey: string | null }[];
  }[];
  taxYears: { entity: string; year: number; state: string }[];
}

const tick = (ok: boolean) => (ok ? "✅" : "❌");

function esc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function checkTable(checks: Check[]): string {
  if (checks.length === 0) return "_none_\n";
  const lines = ["| Check | Expected | Actual | |", "| --- | ---: | ---: | :-: |"];
  for (const c of checks) {
    lines.push(
      `| ${esc(c.label)}${c.critical ? "" : " _(info)_"} | ${esc(c.expected)} | ${esc(c.actual)} | ${tick(c.ok)}${c.note && !c.ok ? ` ${esc(c.note)}` : ""} |`,
    );
  }
  return lines.join("\n") + "\n";
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const i of items) m.set(key(i), [...(m.get(key(i)) ?? []), i]);
  return m;
}

function checkSections(checks: Check[]): string {
  let out = "";
  for (const [group, items] of groupBy(checks, (c) => c.group)) {
    const failed = items.filter((c) => !c.ok).length;
    out += `\n#### ${group} — ${items.length - failed}/${items.length} ✅${failed ? ` (${failed} ❌)` : ""}\n\n`;
    // Big class × sub-type tables are collapsed to the failures plus a one-line summary when all pass.
    if (items.length > 30 && failed === 0) {
      out += `All ${items.length} cells match to the cent.\n`;
    } else {
      out += checkTable(items);
    }
  }
  return out;
}

export function renderReport(s: ImportSummary): string {
  const failedCritical = [
    ...s.checks.preA,
    ...s.checks.preB,
    ...s.checks.models,
    ...s.checks.db,
  ].filter((c) => !c.ok && c.critical);
  const failedInfo = [
    ...s.checks.preA,
    ...s.checks.preB,
    ...s.checks.models,
    ...s.checks.db,
  ].filter((c) => !c.ok && !c.critical);
  const total =
    s.checks.preA.length + s.checks.preB.length + s.checks.models.length + s.checks.db.length;
  const out: string[] = [];
  out.push(`# Import report — historical books (Phase 2)\n`);
  out.push(
    `Generated ${s.finishedAt} by ${s.actorName} (${s.trigger}${s.dryRun ? ", dry run" : ""}), run \`${s.runId}\`, ${(s.durationMs / 1000).toFixed(1)} s. Outcome: **${s.outcome}**${s.error ? ` — ${s.error}` : ""}.\n`,
  );
  out.push(
    `**${total - failedCritical.length - failedInfo.length} of ${total} checks pass.** ${failedCritical.length === 0 ? "Every critical number ties to the cent." : `${failedCritical.length} critical check${failedCritical.length === 1 ? "" : "s"} failed — nothing was forced; see below.`}${failedInfo.length ? ` ${failedInfo.length} informational check${failedInfo.length === 1 ? " differs" : "s differ"} from the note in the docs (explained inline).` : ""}\n`,
  );
  out.push(`## Sources\n`);
  out.push(`| Workbook | File | SHA-256 | Size |\n| --- | --- | --- | ---: |`);
  for (const src of s.sources)
    out.push(
      `| ${src.key} | \`${src.file}\` | \`${src.sha256}\` | ${(src.bytes / 1024).toFixed(0)} KB |`,
    );
  out.push("");
  out.push(`## What was written\n`);
  out.push(`| | Already present (skipped) | Inserted this run |\n| --- | ---: | ---: |`);
  out.push(
    `| 2019–2024 transactions | ${s.load.a.existing.toLocaleString("en-US")} | ${s.load.a.inserted.toLocaleString("en-US")} |`,
  );
  out.push(
    `| 2025 transactions | ${s.load.b.existing.toLocaleString("en-US")} | ${s.load.b.inserted.toLocaleString("en-US")} |`,
  );
  out.push(
    `| Reference models (2020–2024) | ${s.load.models.existing} | ${s.load.models.inserted} |`,
  );
  out.push("");
  out.push(
    `The ledger now holds ${(s.load.a.existing + s.load.a.inserted).toLocaleString("en-US")} imported 2019–2024 transactions, ${s.load.b.existing + s.load.b.inserted} imported 2025 transactions and ${s.load.models.existing + s.load.models.inserted} reference models${s.dryRun ? " (counting what this dry run would have added)" : ""}.\n`,
  );
  if (s.dryRun)
    out.push(`_Dry run: everything above was rolled back; nothing changed in the database._\n`);
  if (s.load.lockedYearsTouched.length)
    out.push(
      `Filed years written with the import's lock override (one audit row for the run, override counts untouched): ${s.load.lockedYearsTouched.join(", ")}.\n`,
    );
  out.push(
    `Tax years after the run: ${s.taxYears.map((y) => `${y.entity} ${y.year} ${y.state.toLowerCase()}`).join(" · ")}.\n`,
  );

  if (failedCritical.length) {
    out.push(`## ❌ Numbers that do not tie\n`);
    out.push(checkTable(failedCritical));
  }

  out.push(`## 2019–2024 workbook (double-entry)\n`);
  const a = s.extraction.a;
  out.push(
    `${a.lines.toLocaleString("en-US")} journal lines in ${a.entries.toLocaleString("en-US")} transactions, ${a.firstDate} → ${a.lastDate}; ${a.linesWithAmounts.toLocaleString("en-US")} lines carry money. Entries stored as bank transactions / journal entries / adjusting entries by year:\n`,
  );
  out.push(`| Year | Bank | Journal | Adjusting |\n| --- | ---: | ---: | ---: |`);
  for (const [year, kinds] of Object.entries(a.kindsByYear).sort())
    out.push(`| ${year} | ${kinds.BANK ?? 0} | ${kinds.JOURNAL ?? 0} | ${kinds.ADJUSTING ?? 0} |`);
  out.push("");
  out.push(checkSections(s.checks.preA));

  out.push(`\n## 2025 snapshot (single-line rows)\n`);
  const b = s.extraction.b;
  out.push(
    `${b.rows} rows, ${b.firstDate} → ${b.lastDate}; the reader stopped at sheet row ${b.stoppedAtRow ?? "—"}. Rows by bank: ${Object.entries(
      b.byBank,
    )
      .map(([k, v]) => `${k} ${v}`)
      .join(
        " · ",
      )}. ${b.unsplit.count} rows tagged needs_model_split (net ${b.unsplit.net}; ${Object.entries(
      b.unsplit.byClass,
    )
      .map(([k, v]) => `${k} ${v}`)
      .join(
        ", ",
      )}). ${b.joseRows} rows verified by Jose. ${b.receiptRows} rows expect ${b.receiptFiles} receipt files (Phase 3).\n`,
  );
  out.push(checkSections(s.checks.preB));

  out.push(`\n## Cross-entity rows (bridged per decision D3)\n`);
  out.push(
    `${s.crossEntity.providenceOn1101.length} Providence-class rows were paid from SREI's 1101 and get bridge lines (SREI Dr 3102 Capital Distribution / PLA Cr 3101 Capital Contribution). ${s.crossEntity.providenceOn1101.filter((r) => r.beforeLaunch).length} of them are dated before the placeholder PLA launch date ${s.crossEntity.plaLaunchPlaceholder} (decision D2) and are candidates for the sole-proprietor report.\n`,
  );
  out.push(
    `| # | Date | Vendor | Amount | Account | Pre-launch |\n| ---: | --- | --- | ---: | --- | :-: |`,
  );
  for (const r of s.crossEntity.providenceOn1101)
    out.push(
      `| ${r.ref} | ${r.date} | ${esc(r.vendor)} | ${r.amount} | ${esc(r.account)} | ${r.beforeLaunch ? "yes" : ""} |`,
    );
  out.push("");
  if (s.crossEntity.other.length) {
    out.push(`Other cross-entity rows (also bridged):\n`);
    out.push(
      `| # | Date | Vendor | Amount | Account | Class | Bank |\n| ---: | --- | --- | ---: | --- | --- | --- |`,
    );
    for (const r of s.crossEntity.other)
      out.push(
        `| ${r.ref} | ${r.date} | ${esc(r.vendor)} | ${r.amount} | ${esc(r.account)} | ${r.class} | ${r.bank} |`,
      );
    out.push("");
  }
  out.push(
    `The ${s.crossEntity.generalOn1103.length} General-class rows on the PLA bank need no bridge (General takes the bank's entity):\n`,
  );
  out.push(`| # | Date | Vendor | Amount | Account |\n| ---: | --- | --- | ---: | --- |`);
  for (const r of s.crossEntity.generalOn1103)
    out.push(`| ${r.ref} | ${r.date} | ${esc(r.vendor)} | ${r.amount} | ${esc(r.account)} |`);
  out.push("");

  out.push(`## Reference allocation models (2020–2024 Tax Worksheets)\n`);
  out.push(
    `Archived, read-only, never applied. Each percentage set of a worksheet is one model with one version; every number was re-checked against the worksheet cell it came from.\n`,
  );
  for (const y of s.referenceModels) {
    out.push(`### ${y.year} — \`${y.sheet}\`\n`);
    out.push(`${y.method}\n`);
    out.push(
      `Verified against the workbook: ${y.verified.checked} cells checked, ${y.verified.mismatches.length} mismatch${y.verified.mismatches.length === 1 ? "" : "es"}${y.verified.mismatches.length ? ` — ${y.verified.mismatches.join("; ")}` : ""}.\n`,
    );
    for (const m of y.models) {
      out.push(
        `**${m.name}** (${m.basis}${m.secondaryBasis ? ` × ${m.secondaryBasis}` : ""}) — ${m.description}\n`,
      );
      out.push(
        `| Target | Ledger class | Weight | Share | Basis points |\n| --- | --- | ---: | ---: | ---: |`,
      );
      for (const t of m.targets)
        out.push(
          `| ${esc(t.label)} | ${t.target === "PERSONAL" ? "_Personal (3102)_" : t.target} | ${t.weight.toLocaleString("en-US")}${t.weight2 !== null ? ` × ${t.weight2}` : ""} | ${(t.share * 100).toFixed(4)} % | ${t.bp}${t.remainder ? " (remainder)" : ""} |`,
        );
      if (m.problems.length) out.push(`\n⚠️ ${m.problems.join("; ")}`);
      out.push("");
    }
    if (y.bills.length)
      out.push(
        `Specific bills allocated: ${y.bills.map((bill) => `${bill.label} ${bill.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}${bill.setKey ? ` (${bill.setKey})` : ""}`).join("; ")}.\n`,
      );
  }
  out.push(checkSections(s.checks.models));

  out.push(`\n## Read back from the database\n`);
  out.push(checkSections(s.checks.db));

  out.push(`\n## Chart of accounts: workbook vs seed\n`);
  out.push(
    `In the workbook's chart but not in the seed: ${s.chartDiff.inWorkbookNotSeed.length ? s.chartDiff.inWorkbookNotSeed.join(", ") : "none"}.\n`,
  );
  out.push(
    `In the seed but not in the workbook's chart: ${s.chartDiff.inSeedNotWorkbook.length ? s.chartDiff.inSeedNotWorkbook.join(", ") : "none"}.\n`,
  );
  if (s.chartDiff.differences.length) {
    out.push(`Differences:\n`);
    for (const d of s.chartDiff.differences) out.push(`- ${d}`);
    out.push("");
  }

  out.push(`## Rows and questions needing a human\n`);
  for (const sec of s.attention) {
    out.push(`### ${sec.title}\n`);
    for (const item of sec.items) out.push(`- ${item}`);
    out.push("");
  }

  out.push(`## Details the import had to decide\n`);
  out.push(
    `- Negative amounts (P0-1): ${a.normalised.length} lines in the year-end reallocation entries carry a negative debit or credit in the workbook; each is stored on the other side as a positive amount. Net totals are unchanged.\n`,
  );
  if (a.normalised.length) {
    out.push(
      `| Txn | Row | Account | Class | In the workbook | Stored as |\n| ---: | ---: | --- | --- | ---: | ---: |`,
    );
    for (const n of a.normalised)
      out.push(
        `| ${n.txn} | ${n.row} | ${esc(n.account)} | ${esc(n.class)} | ${n.raw} | ${n.storedAs} |`,
      );
    out.push("");
  }
  out.push(
    `- Zero-amount entries (P0-3): transactions ${a.zeroEntries.join(", ")} are voided placeholders with no lines.`,
  );
  out.push(
    `- Entries whose lines carry two dates: ${a.mixedDates.map((m) => `#${m.txn} (${m.dates.join(" / ")})`).join(", ") || "none"}; the earliest date is used and both are kept in the system note.`,
  );
  out.push(
    `- Transfers between own bank accounts: ${a.transfers.length ? a.transfers.map((t) => `#${t}`).join(", ") : "none"} (shown from 1101, decision P1-18).`,
  );
  out.push(
    `- ${a.entriesWithoutName} entries have no Name on any line (year-end reallocations, depreciation, bank-side entries); they show “—” as the vendor and keep their memo.`,
  );
  out.push(
    `- ${a.formulaCellsWithoutCachedResult} formula cells had no cached value and were read as 0.00; ${a.subCentAmounts} amounts carried fractions of a cent and were rounded per line (every entry still balances).`,
  );
  out.push("");
  return out.join("\n");
}
