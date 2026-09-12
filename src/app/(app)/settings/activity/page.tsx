import Link from "next/link";
import { ScrollText, Download } from "lucide-react";
import { db } from "@/lib/db";
import { requireFullSession } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/format";
import {
  activityFiltersToParams,
  ACTIVITY_EXPORT_MAX_ROWS,
  describeFilters,
  listAuditActions,
  listAuditUsers,
  parseActivityParams,
  queryAuditLog,
} from "@/lib/activity";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";
import { Button } from "@/components/ui/button";
import { ActivityFilterForm } from "@/components/settings/activity/activity-filters";
import {
  ActivityTable,
  type ActivityTableRow,
} from "@/components/settings/activity/activity-table";

export const metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

function pretty(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value, null, 2);
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireFullSession("/settings/activity");
  const { filters, page, pageSize } = parseActivityParams(await searchParams);

  const [result, actions, users, entities] = await Promise.all([
    queryAuditLog(db, filters, { page, pageSize }),
    listAuditActions(db),
    listAuditUsers(db),
    db.entity.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);

  const rows: ActivityTableRow[] = result.rows.map((r) => ({
    id: r.id.toString(),
    atLabel: formatDateTime(r.at),
    atIso: r.at.toISOString(),
    user: r.userId ? (r.userName ?? r.userEmail ?? "unknown user") : "system",
    userEmail: r.userEmail,
    action: r.action,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    subjectLabel: r.subjectLabel,
    entityCode: r.entityCode,
    reason: r.reason,
    ip: r.ip,
    isLockOverride: r.isLockOverride,
    sessionId: r.sessionId,
    userAgent: r.userAgent,
    beforeJson: pretty(r.before),
    afterJson: pretty(r.after),
  }));

  const total = result.total;
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const pageHref = (p: number) =>
    `/settings/activity?${activityFiltersToParams(filters, { page: p > 1 ? p : undefined, pageSize: pageSize !== 50 ? pageSize : undefined }).toString()}`;
  const exportHref = `/api/activity/export?${activityFiltersToParams(filters).toString()}`;
  const hasFilters = Object.values(filters).some((v) => v !== undefined && v !== "");
  const filterSummary = describeFilters(filters, {
    user: users.find((u) => u.id === filters.userId)?.displayName,
    entity: entities.find((e) => e.id === filters.entityId)?.code,
  });

  return (
    <div>
      <PageHeader
        title="Activity"
        helper="Every sign-in, change, export and settings edit, newest first. This log can be read and filtered but never edited or deleted."
        actions={
          <Button
            asChild
            variant="outline"
            size="sm"
            title={`Download the current filter as a spreadsheet file (up to ${ACTIVITY_EXPORT_MAX_ROWS.toLocaleString()} rows)`}
          >
            <a href={exportHref}>
              <Download aria-hidden />
              Export CSV
            </a>
          </Button>
        }
      />

      <ActivityFilterForm filters={filters} users={users} actions={actions} entities={entities} />

      {total === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={hasFilters ? "Nothing matches these filters" : "Nothing has been logged yet"}
          description={
            hasFilters
              ? `No log entries for ${filterSummary}. Try widening the dates or clearing a filter.`
              : "As soon as someone signs in or changes something, it appears here."
          }
        >
          {hasFilters ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/activity">Clear filters</Link>
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <>
          <div className="text-muted-foreground mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              Showing{" "}
              <span className="tabular">
                {first.toLocaleString()}–{last.toLocaleString()}
              </span>{" "}
              of <span className="tabular">{total.toLocaleString()}</span>
              {hasFilters ? <> · {filterSummary}</> : null}
            </span>
            <span className="text-xs">Click a row to see what changed.</span>
          </div>
          <ActivityTable rows={rows} />
          <div className="mt-3 flex items-center justify-between text-sm">
            <Button
              asChild
              variant="outline"
              size="sm"
              className={page <= 1 ? "pointer-events-none opacity-50" : undefined}
              aria-disabled={page <= 1}
            >
              <Link href={pageHref(page - 1)}>Previous</Link>
            </Button>
            <span className="text-muted-foreground tabular">
              Page {page.toLocaleString()} of {lastPage.toLocaleString()}
            </span>
            <Button
              asChild
              variant="outline"
              size="sm"
              className={page >= lastPage ? "pointer-events-none opacity-50" : undefined}
              aria-disabled={page >= lastPage}
            >
              <Link href={pageHref(page + 1)}>Next</Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
