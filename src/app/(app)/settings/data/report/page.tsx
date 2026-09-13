import Link from "next/link";
import { ArrowLeft, Download, FileText } from "lucide-react";
import { db } from "@/lib/db";
import { requireFullSession } from "@/lib/auth/current-user";
import { importRunReport } from "@/lib/import/status";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/settings/data/markdown";

export const metadata = { title: "Import report" };
export const dynamic = "force-dynamic";

export default async function ImportReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireFullSession("/settings/data/report");
  const params = await searchParams;
  const runId = typeof params.run === "string" ? params.run : null;
  const report = await importRunReport(db, runId);
  const helper = report
    ? `Run of ${formatDateTime(report.startedAt)}${report.dryRun ? " (dry run: nothing was written)" : report.status === "FAILED" ? " (stopped: nothing was written)" : ""}. Every run keeps its own report; use “Download .md” to keep a copy.`
    : "No report yet.";
  return (
    <div>
      <PageHeader
        title="Import report"
        helper={helper}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/data">
                <ArrowLeft aria-hidden />
                Back to Data
              </Link>
            </Button>
            {report ? (
              <Button asChild variant="outline" size="sm">
                <a href={`/api/import/report?run=${report.id}`}>
                  <Download aria-hidden />
                  Download .md
                </a>
              </Button>
            ) : null}
          </div>
        }
      />
      {report ? (
        <div className="bg-card rounded-lg border p-6">
          <Markdown text={report.markdown} />
        </div>
      ) : (
        <EmptyState
          icon={FileText}
          title="No import report here"
          description={
            runId
              ? "That run does not exist or has no report. Go back to Data and pick one from the list."
              : "Run the import from Settings → Data or with pnpm import:run; the report appears here."
          }
        />
      )}
    </div>
  );
}
