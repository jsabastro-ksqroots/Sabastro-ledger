import Link from "next/link";
import { db } from "@/lib/db";
import { requireFullSession } from "@/lib/auth/current-user";
import { getUiScope } from "@/lib/ui-scope";
import { countYear } from "@/lib/ledger/tax-years";
import { PageHeader } from "@/components/shell/page-header";
import { StatusChip } from "@/components/status-chip";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/format";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ recovery_left?: string }>;
}) {
  const params = await searchParams;
  const user = await requireFullSession();
  const scope = await getUiScope();
  const [accounts, classes, lastLogin, counts, lastImport, importedYears] = await Promise.all([
    db.account.count({ where: { isActive: true } }),
    db.class.count({ where: { isActive: true } }),
    db.auditLog.findFirst({
      where: { userId: user.id, action: "login.success" },
      orderBy: { at: "desc" },
      skip: 1,
    }),
    scope.entity && scope.year ? countYear(db, scope.entity.id, scope.year.year) : null,
    db.importRun.findFirst({
      where: { status: "SUCCEEDED", dryRun: false },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    }),
    db.transaction.groupBy({
      by: ["sourceFile"],
      where: { source: "IMPORT", status: { in: ["POSTED", "FLAGGED"] } },
      _count: { _all: true },
    }),
  ]);
  const importedTotal = importedYears.reduce((t, r) => t + r._count._all, 0);
  const open = (counts?.draft ?? 0) + (counts?.flagged ?? 0);
  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user.displayName.split(" ")[0]}`}
        helper="Where the books stand and what needs a decision. Change the business or the year in the top bar."
      />
      {params.recovery_left ? (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You signed in with a recovery code and have {params.recovery_left} left. Generate a new
          set from Settings → Users soon.
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Working in</CardDescription>
            <CardTitle className="text-lg">
              {scope.entity ? `${scope.entity.code} · ${scope.entity.name}` : "No entity"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Tax year{" "}
            {scope.year ? (
              <>
                {scope.year.year} <StatusChip status={scope.year.state} />
              </>
            ) : (
              "—"
            )}
            . {accounts} active accounts, {classes} active classes.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>
              The books for {scope.entity?.code ?? "—"} {scope.year?.year ?? ""}
            </CardDescription>
            <CardTitle className="tabular text-lg">
              {counts
                ? `${counts.posted.toLocaleString("en-US")} posted transactions`
                : "No year selected"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            {counts ? (
              <>
                {open > 0 ? (
                  <>
                    <span className="font-medium text-amber-800">
                      {open} waiting for a decision
                    </span>{" "}
                    ({counts.flagged} flagged, {counts.draft} draft).
                  </>
                ) : (
                  "Nothing is waiting for a decision."
                )}{" "}
                {counts.voided ? `${counts.voided} voided. ` : ""}
                <Link href="/ledger" className="underline underline-offset-4">
                  Open the ledger
                </Link>
                .
              </>
            ) : (
              "Pick a business and a year in the top bar."
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Your previous sign-in</CardDescription>
            <CardTitle className="text-lg">
              {lastLogin ? formatDateTime(lastLogin.at) : "This is your first"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Every sign-in is recorded.{" "}
            <Link href="/settings/activity" className="underline underline-offset-4">
              See the Activity log
            </Link>
            .
          </CardContent>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">What is built so far (Phases 0–2 of 7)</CardTitle>
          <CardDescription>
            Sign-in with authenticator codes, roles and the audit log (Phase 0). The ledger: journal
            entries, splits, the cross-entity bridge, the closed-year lock (Phase 1).{" "}
            {importedTotal > 0 && lastImport
              ? `The historical books, imported on ${formatDate(lastImport.startedAt)}: ${importedTotal.toLocaleString("en-US")} transactions from the 2019–2024 workbook and the 2025 snapshot, six filed years for SREI, and the 2020–2024 allocation worksheets archived under Settings → Data (Phase 2).`
              : "The historical import is ready to run from Settings → Data (Phase 2)."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Next: Phase 3 adds receipts, the AI classifier and the Review queue. Receipts, Statements,
          Reports and Performance in the sidebar are placeholders until their phase.
        </CardContent>
      </Card>
    </div>
  );
}
