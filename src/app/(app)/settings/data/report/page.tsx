import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { db } from "@/lib/db";
import { requireFullSession } from "@/lib/auth/current-user";
import { importRunReport } from "@/lib/import/status";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/settings/data/markdown";
import { FileText } from "lucide-react";

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
  return (
    <div>
      <PageHeader
        title="Import report"
        helper={
          report
            ? `Run of ${formatDateTime(report.startedAt)}${report.dryRun ? " (dry run)" : ""}. The same text is saved as docs/IMPORT_REPORT.md.`
            : "No report yet."
        }
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
                <a href={`/api/import/report${runId ? `?run=${runId}` : ""}`}>
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
          title="No import report yet"
          description="Run the import from Settings → Data or with pnpm import:run; the report appears here."
        />
      )}
    </div>
  );
}
