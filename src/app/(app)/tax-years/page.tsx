import Link from "next/link";
import { db } from "@/lib/db";
import { requireFullSession } from "@/lib/auth/current-user";
import { getUiScope } from "@/lib/ui-scope";
import { countYear } from "@/lib/ledger/tax-years";
import { PageHeader } from "@/components/shell/page-header";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Tax Years" };
export const dynamic = "force-dynamic";

export default async function TaxYearsPage() {
  await requireFullSession("/tax-years");
  const scope = await getUiScope();
  const years = scope.entity
    ? await db.taxYear.findMany({ where: { entityId: scope.entity.id }, orderBy: { year: "desc" } })
    : [];
  const counts = await Promise.all(years.map((y) => countYear(db, y.entityId, y.year)));
  return (
    <div>
      <PageHeader
        title={`Tax years · ${scope.entity?.code ?? ""}`}
        helper="One row per year. Open years can be edited freely; closed and filed years warn before any change and count every override. Open a year for its year-end checklist and to close, file or re-open it."
      />
      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Posted</TableHead>
              <TableHead className="text-right">Open</TableHead>
              <TableHead>Closed</TableHead>
              <TableHead>Filed</TableHead>
              <TableHead className="text-right">Overrides</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {years.map((y, i) => {
              const c = counts[i];
              const open = (c?.draft ?? 0) + (c?.flagged ?? 0);
              return (
                <TableRow key={y.id}>
                  <TableCell className="tabular font-medium">
                    <Link
                      href={`/tax-years/${y.year}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {y.year}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusChip status={y.state} />
                  </TableCell>
                  <TableCell className="tabular text-right">{c?.posted ?? 0}</TableCell>
                  <TableCell
                    className={
                      "tabular text-right " +
                      (open > 0 ? "text-amber-800" : "text-muted-foreground")
                    }
                  >
                    {open}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(y.closedAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(y.filedAt)}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {y.overrideCount > 0 ? (
                      <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-600/20 ring-inset">
                        {y.state === "OPEN" ? "" : `${y.state.toLowerCase()} — `}overridden{" "}
                        {y.overrideCount} {y.overrideCount === 1 ? "time" : "times"}
                      </span>
                    ) : (
                      "0"
                    )}
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground max-w-[16rem] truncate"
                    title={y.note ?? undefined}
                  >
                    {y.note}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="outline" size="xs">
                      <Link href={`/tax-years/${y.year}`}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {years.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-muted-foreground py-10 text-center">
                  No tax years yet for this entity. A year is created automatically the first time
                  something is posted in it.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
