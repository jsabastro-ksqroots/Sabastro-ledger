import { TagsIcon } from "lucide-react";
import { db } from "@/lib/db";
import { requireFullSession } from "@/lib/auth/current-user";
import { hasFullAccess } from "@/lib/auth/permissions";
import { listClasses } from "@/lib/org/classes";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";
import { ClassesToolbar } from "@/components/settings/classes/classes-toolbar";
import { ClassesTable } from "@/components/settings/classes/classes-table";
import { ClassDialog } from "@/components/settings/classes/class-dialog";

export const metadata = { title: "Classes" };

export default async function ClassesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ inactive?: string }>;
}) {
  const params = await searchParams;
  const user = await requireFullSession("/settings/classes");
  const canEdit = hasFullAccess(user.role);
  const showInactive = params.inactive === "1";

  const [classes, entities] = await Promise.all([
    listClasses(db, { includeInactive: showInactive }),
    db.entity.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Classes"
        helper="Every transaction line carries a class; 544 Liberty and 176 Tulsk are legal entities tracked as classes. A class that has been used can be deactivated but never deleted."
        actions={canEdit ? <ClassDialog mode="create" entities={entities} /> : undefined}
      />
      {!canEdit ? (
        <p className="text-muted-foreground mb-4 text-sm">
          You can browse the classes but not change them — that takes Owner or Full access.
        </p>
      ) : null}
      <ClassesToolbar showInactive={showInactive} />
      {classes.length === 0 ? (
        <EmptyState
          icon={TagsIcon}
          title="No classes yet"
          description="Classes are seeded from seed/classes.csv the first time the app runs. Run the seed, or add a class here."
        />
      ) : (
        <ClassesTable classes={classes} entities={entities} canEdit={canEdit} />
      )}
      <p className="text-muted-foreground tabular mt-3 text-xs">
        {classes.length} {classes.length === 1 ? "class" : "classes"} shown
        {showInactive ? " (including inactive)" : ""}.
      </p>
    </div>
  );
}
