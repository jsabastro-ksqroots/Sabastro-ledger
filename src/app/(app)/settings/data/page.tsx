import Link from "next/link";
import { Database, Download, FileText } from "lucide-react";
import { db } from "@/lib/db";
import { requireFullSession } from "@/lib/auth/current-user";
import { hasFullAccess } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/format";
import {
  checksSentence,
  importSourceDir,
  listImportRuns,
  listReferenceModels,
  sourceStatuses,
} from "@/lib/import/status";
import { PageHeader } from "@/components/shell/page-header";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RerunImportForm } from "@/components/settings/data/rerun-import-form";

export const metadata = { title: "Data" };
export const dynamic = "force-dynamic";

function resultChip(r: {
  status: string;
  isStale: boolean;
  checks: { failed: number; failedCritical: number } | null;
}) {
  if (r.status === "RUNNING")
    return r.isStale ? (
      <StatusChip status="VOIDED" label="Interrupted" />
    ) : (
      <StatusChip status="DRAFT" label="Running" />
    );
  if (r.status === "FAILED") return <StatusChip status="VOIDED" label="Stopped" />;
  if (!r.checks || r.checks.failed === 0)
    return <StatusChip status="POSTED" label="All checks pass" />;
  if (r.checks.failedCritical === 0)
    return (
      <StatusChip
        status="FLAGGED"
        label={`Numbers tie · ${r.checks.failed} note${r.checks.failed === 1 ? "" : "s"}`}
      />
    );
  return <StatusChip status="VOIDED" label="Checks differ" />;
}

export default async function DataPage() {
  const user = await requireFullSession("/settings/data");
  const [sources, runs, models] = await Promise.all([
    sourceStatuses(db),
    listImportRuns(db),
    listReferenceModels(db),
  ]);
  const latest =
    runs.find((r) => r.hasReport && !r.dryRun && r.status === "SUCCEEDED") ??
    runs.find((r) => r.hasReport) ??
    null;
  const filesPresent = sources.every((s) => s.present);
  const totalImported = sources.reduce(
    (t, s) =>
      t +
      s.transactions.posted +
      s.transactions.flagged +
      s.transactions.voided +
      s.transactions.draft,
    0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data"
        helper="Where the books came from: the two source workbooks, what was imported from them and when, the archived allocation worksheets, and the import report."
        actions={
          latest ? (
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/settings/data/report?run=${latest.id}`}>
                  <FileText aria-hidden />
                  Open import report
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={`/api/import/report?run=${latest.id}`}>
                  <Download aria-hidden />
                  Download .md
                </a>
              </Button>
            </div>
          ) : null
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        {sources.map((s) => (
          <Card key={s.key}>
            <CardHeader>
              <CardTitle className="text-base">Workbook {s.key}</CardTitle>
              <CardDescription>{s.label}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <StatusChip
                  status={s.present ? "ACTIVE" : "INACTIVE"}
                  label={s.present ? "File present" : "File missing"}
                />
                <code className="text-muted-foreground truncate text-xs" title={s.file}>
                  {s.file}
                </code>
              </div>
              <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
                <dt className="text-muted-foreground">Imported</dt>
                <dd className="tabular">
                  {totalImported === 0 && s.transactions.posted === 0 ? (
                    "nothing yet"
                  ) : (
                    <>
                      {s.transactions.posted.toLocaleString("en-US")} posted
                      {s.transactions.flagged ? `, ${s.transactions.flagged} flagged` : ""}
                      {s.transactions.voided ? `, ${s.transactions.voided} voided` : ""}
                      {s.transactions.draft ? `, ${s.transactions.draft} draft` : ""}
                      {s.firstDate ? ` · ${s.firstDate} → ${s.lastDate}` : ""}
                    </>
                  )}
                </dd>
                <dt className="text-muted-foreground">On disk</dt>
                <dd className="tabular">
                  {s.present
                    ? `${((s.bytes ?? 0) / 1024).toFixed(0)} KB, saved ${formatDateTime(s.modifiedAt ? new Date(s.modifiedAt) : null)}`
                    : "not found in the import folder"}
                </dd>
                <dt className="text-muted-foreground">Same file?</dt>
                <dd title={s.sha256 ? `SHA-256 ${s.sha256}` : undefined}>
                  {!s.present
                    ? "—"
                    : !s.importedAt
                      ? "Not imported yet."
                      : s.changedSinceImport
                        ? `Changed since the import of ${formatDateTime(new Date(s.importedAt))}. Rows already in the ledger are not updated by a re-run; only rows missing from the ledger are added.`
                        : `Unchanged since the import of ${formatDateTime(new Date(s.importedAt))}.`}
                </dd>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Re-run the import</CardTitle>
          <CardDescription>
            {totalImported === 0
              ? "Nothing has been imported yet. The import reads both workbooks, checks every number against the acceptance list, and only then writes."
              : "Safe to run again: rows already in the ledger are skipped, everything else is re-checked, and a check that does not tie stops the run with nothing written."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RerunImportForm
            canRun={hasFullAccess(user.role)}
            filesPresent={filesPresent}
            sourceDir={importSourceDir()}
          />
          <p className="text-muted-foreground mt-3 text-xs">
            The import can also be run from the Terminal (see the “Importing the historical books”
            section of HOW_TO_RUN.md), which also saves the report as a file.
          </p>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-2 text-base font-semibold">Import runs</h2>
        {runs.length === 0 ? (
          <div className="bg-card text-muted-foreground rounded-lg border p-6 text-sm">
            <Database className="mb-2 h-5 w-5" aria-hidden />
            No import has run yet.
          </div>
        ) : (
          <div className="bg-card rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>How</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="text-right">Added (2019–24 / 2025 / models)</TableHead>
                  <TableHead className="text-right">Already there</TableHead>
                  <TableHead>Checks</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(new Date(r.startedAt))}
                    </TableCell>
                    <TableCell>{r.runBy ?? "system"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.trigger === "cli" ? "Terminal" : "Settings"}
                      {r.dryRun ? " · dry run" : ""}
                    </TableCell>
                    <TableCell>
                      {resultChip(r)}
                      {r.error ? (
                        <div
                          className="text-muted-foreground mt-1 max-w-[24rem] truncate text-xs"
                          title={r.error}
                        >
                          {r.error}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {r.inserted
                        ? `${r.inserted.a.toLocaleString("en-US")} / ${r.inserted.b} / ${r.inserted.models}`
                        : "—"}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {r.skipped
                        ? `${r.skipped.a.toLocaleString("en-US")} / ${r.skipped.b} / ${r.skipped.models}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {r.checks ? checksSentence(r.checks) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.hasReport ? (
                        <Button asChild variant="outline" size="xs">
                          <Link href={`/settings/data/report?run=${r.id}`}>Report</Link>
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-1 text-base font-semibold">
          Archived allocation worksheets (reference models)
        </h2>
        <p className="text-muted-foreground mb-2 text-sm">
          The 2020–2024 Tax Worksheet percentage sets, kept read-only for documentation. They are
          never applied; Phase 5 builds live models on the same tables.
        </p>
        {models.length === 0 ? (
          <div className="bg-card text-muted-foreground rounded-lg border p-6 text-sm">
            None imported yet.
          </div>
        ) : (
          <div className="bg-card rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Year</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Basis</TableHead>
                  <TableHead>Targets and shares</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map((m) => (
                  <TableRow key={`${m.year}-${m.name}`}>
                    <TableCell className="tabular">{m.year}</TableCell>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.basis.toLowerCase()}
                      {m.secondaryBasis ? ` × ${m.secondaryBasis.toLowerCase()}` : ""}
                    </TableCell>
                    <TableCell className="text-xs">
                      {m.targets.map((t) => (
                        <span key={t.label} className="mr-3 inline-block whitespace-nowrap">
                          {t.isPersonal ? <em>Personal</em> : (t.className ?? t.label)}{" "}
                          <span className="tabular text-muted-foreground">{t.sharePct} %</span>
                        </span>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
