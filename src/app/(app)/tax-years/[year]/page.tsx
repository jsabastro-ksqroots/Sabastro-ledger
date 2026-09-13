import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireFullSession, userCan, userIsOwner } from "@/lib/auth/current-user";
import { getUiScope } from "@/lib/ui-scope";
import { getChecklist } from "@/lib/ledger/tax-years";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shell/page-header";
import { StatusChip } from "@/components/status-chip";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { YearChecklist } from "@/components/tax-years/year-checklist";
import { YearActions } from "@/components/tax-years/year-actions";

export const metadata = { title: "Tax year" };
export const dynamic = "force-dynamic";

export default async function TaxYearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year: yearParam } = await params;
  const user = await requireFullSession(`/tax-years/${yearParam}`);
  const scope = await getUiScope();
  const year = Number(yearParam);
  if (!scope.entity || !Number.isInteger(year)) notFound();
  const taxYear = await db.taxYear.findUnique({
    where: { entityId_year: { entityId: scope.entity.id, year } },
    include: { entity: { select: { code: true, name: true } } },
  });
  if (!taxYear) notFound();
  const { items, counts, canClose } = await getChecklist(db, taxYear);
  const canCloseYear = userCan(user, "CLOSE_YEAR");
  const isOwner = userIsOwner(user, "REOPEN_YEAR");
  const overrides = await db.auditLog.findMany({
    where: { taxYearId: taxYear.id, isLockOverride: true },
    orderBy: { id: "desc" },
    take: 20,
    include: { user: { select: { displayName: true } } },
  });

  return (
    <div>
      <PageHeader
        title={`${taxYear.entity.code} · Tax year ${taxYear.year}`}
        helper="The year-end checklist gates “Mark closed”. Once closed, every change to the year asks for a reason and is counted here. Exports, the filed return and supporting documents attach here in Phase 6."
        actions={
          <Link
            href="/tax-years"
            className="text-muted-foreground text-sm underline-offset-4 hover:underline"
          >
            ← All years
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                Year-end checklist <StatusChip status={taxYear.state} />
                {taxYear.overrideCount > 0 ? (
                  <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-600/20 ring-inset">
                    overridden {taxYear.overrideCount}{" "}
                    {taxYear.overrideCount === 1 ? "time" : "times"}
                  </span>
                ) : null}
              </CardTitle>
              <CardDescription>
                Every item must be satisfied automatically, ticked by hand, or overridden with a
                reason before the year can be closed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <YearChecklist
                taxYearId={taxYear.id}
                items={items.map((i) => ({
                  ...i,
                  doneAt: i.doneAt ? i.doneAt.toISOString() : null,
                }))}
                canEdit={canCloseYear && taxYear.state === "OPEN"}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Overrides on this year</CardTitle>
              <CardDescription>
                Changes made after the year was closed or filed, newest first (also in Settings →
                Activity).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {overrides.length === 0 ? (
                <p className="text-muted-foreground text-sm">None.</p>
              ) : (
                <ol className="space-y-2 text-sm">
                  {overrides.map((o) => (
                    <li key={o.id.toString()} className="rounded-md border px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs">{o.action}</span>
                        <span className="text-muted-foreground tabular text-xs">
                          {formatDateTime(o.at)} · {o.user?.displayName ?? "system"}
                        </span>
                        {o.subjectLabel ? (
                          <span className="text-muted-foreground text-xs">· {o.subjectLabel}</span>
                        ) : null}
                      </div>
                      {o.reason ? <div className="mt-1">{o.reason}</div> : null}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">This year in numbers</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Posted</dt>
                <dd className="tabular text-right">{counts.posted}</dd>
                <dt className="text-muted-foreground">Drafts</dt>
                <dd className="tabular text-right">{counts.draft}</dd>
                <dt className="text-muted-foreground">Flagged</dt>
                <dd className="tabular text-right">{counts.flagged}</dd>
                <dt className="text-muted-foreground">Voided</dt>
                <dd className="tabular text-right">{counts.voided}</dd>
                <dt className="text-muted-foreground">Adjusting entries</dt>
                <dd className="tabular text-right">{counts.adjusting}</dd>
              </dl>
              <dl className="text-muted-foreground mt-3 space-y-1 border-t pt-3 text-xs">
                {taxYear.closedAt ? <div>Closed {formatDateTime(taxYear.closedAt)}</div> : null}
                {taxYear.filedAt ? <div>Filed {formatDateTime(taxYear.filedAt)}</div> : null}
                {taxYear.note ? <div>Note: {taxYear.note}</div> : null}
              </dl>
            </CardContent>
          </Card>
          <YearActions
            taxYearId={taxYear.id}
            label={`${taxYear.entity.code} ${taxYear.year}`}
            state={taxYear.state}
            canClose={canClose}
            canCloseYear={canCloseYear}
            isOwner={isOwner}
          />
        </div>
      </div>
    </div>
  );
}
