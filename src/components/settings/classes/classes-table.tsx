import { CLASS_KIND_LABELS, type ClassKindKey, type ClassRow } from "@/lib/org/classes";
import { StatusChip } from "@/components/status-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ClassDialog, type EntityOption } from "./class-dialog";
import { ClassActiveButton } from "./class-active-button";

/** Classes sorted by sort order then name. Server component. */
export function ClassesTable({
  classes,
  entities,
  canEdit,
}: {
  classes: ClassRow[];
  entities: EntityOption[];
  canEdit: boolean;
}) {
  return (
    <div className="bg-card overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader className="bg-card sticky top-0">
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="w-20">Entity</TableHead>
            <TableHead className="w-36">Kind</TableHead>
            <TableHead className="w-40">Legal entity</TableHead>
            <TableHead className="w-28">Years</TableHead>
            <TableHead className="w-24">Status</TableHead>
            <TableHead>Note</TableHead>
            {canEdit ? <TableHead className="w-40 text-right">Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {classes.map((c) => (
            <TableRow key={c.id} className={c.isActive ? "" : "text-muted-foreground"}>
              <TableCell className="font-medium">
                {c.name}
                {c.isShared ? (
                  <span className="text-muted-foreground ml-2 text-xs font-normal">shared</span>
                ) : null}
              </TableCell>
              <TableCell className="tabular">{c.entity.code}</TableCell>
              <TableCell className="text-muted-foreground">
                {CLASS_KIND_LABELS[c.kind as ClassKindKey] ?? c.kind}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {c.isLegalEntity ? (c.legalEntityName ?? "Yes") : "—"}
              </TableCell>
              <TableCell className="text-muted-foreground tabular">{c.yearsNote ?? ""}</TableCell>
              <TableCell>
                <StatusChip status={c.isActive ? "ACTIVE" : "INACTIVE"} />
              </TableCell>
              <TableCell className="max-w-[18rem]">
                {c.note ? (
                  <span className="text-muted-foreground block truncate" title={c.note}>
                    {c.note}
                  </span>
                ) : null}
              </TableCell>
              {canEdit ? (
                <TableCell className="text-right whitespace-nowrap">
                  <ClassDialog
                    mode="edit"
                    entities={entities}
                    cls={{
                      id: c.id,
                      name: c.name,
                      entityId: c.entityId,
                      entityCode: c.entity.code,
                      kind: c.kind,
                      isShared: c.isShared,
                      isLegalEntity: c.isLegalEntity,
                      legalEntityName: c.legalEntityName ?? "",
                      yearsNote: c.yearsNote ?? "",
                      note: c.note ?? "",
                      sortOrder: c.sortOrder,
                    }}
                    trigger={
                      <Button variant="ghost" size="xs">
                        Edit
                      </Button>
                    }
                  />
                  {c.isShared ? null : (
                    <ClassActiveButton id={c.id} name={c.name} isActive={c.isActive} />
                  )}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
