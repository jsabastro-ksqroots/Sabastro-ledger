import { db } from "@/lib/db";
import { getUiScope } from "@/lib/ui-scope";
import { PageHeader } from "@/components/shell/page-header";
import { StatusChip } from "@/components/status-chip";
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

export default async function TaxYearsPage() {
  const scope = await getUiScope();
  const years = scope.entity
    ? await db.taxYear.findMany({ where: { entityId: scope.entity.id }, orderBy: { year: "desc" } })
    : [];
  return (
    <div>
      <PageHeader
        title={`Tax years · ${scope.entity?.code ?? ""}`}
        helper="One row per year. Open years can be edited freely; closed and filed years warn before any change. Closing, exports and filed returns arrive in Phase 6."
      />
      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Closed</TableHead>
              <TableHead>Filed</TableHead>
              <TableHead className="text-right">Overrides</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {years.map((y) => (
              <TableRow key={y.id}>
                <TableCell className="tabular font-medium">{y.year}</TableCell>
                <TableCell>
                  <StatusChip status={y.state} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(y.closedAt)}
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDateTime(y.filedAt)}</TableCell>
                <TableCell className="tabular text-right">{y.overrideCount}</TableCell>
                <TableCell className="text-muted-foreground">{y.note}</TableCell>
              </TableRow>
            ))}
            {years.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-10 text-center">
                  No tax years yet for this entity.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
