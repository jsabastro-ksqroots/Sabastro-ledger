import { db } from "@/lib/db";
import { requireFullSession, userCan } from "@/lib/auth/current-user";
import { getUiScope } from "@/lib/ui-scope";
import { listLedgerRows, loadPickerData } from "@/lib/ledger/query";
import { listSavedViews } from "@/lib/ledger/saved-views";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";
import { LedgerGrid } from "@/components/ledger/ledger-grid";
import { BookOpen } from "lucide-react";

export const metadata = { title: "Ledger" };
export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  const user = await requireFullSession("/ledger");
  const scope = await getUiScope();
  if (!scope.entity || !scope.year) {
    return (
      <div>
        <PageHeader title="Ledger" helper="Pick an entity and a tax year in the top bar." />
        <EmptyState
          icon={BookOpen}
          title="No entity or tax year selected"
          description="Run the seed (pnpm db:seed) to create SREI, PLA and their tax years."
        />
      </div>
    );
  }
  const taxYear = await db.taxYear.findUnique({
    where: { id: scope.year.id },
    select: { state: true, overrideCount: true },
  });
  const [rows, picker, views] = await Promise.all([
    listLedgerRows(db, { entityId: scope.entity.id, year: scope.year.year }),
    loadPickerData(db),
    listSavedViews(db, user.id, "ledger"),
  ]);
  const can = { write: userCan(user, "REVIEW_CONFIRM"), editPosted: userCan(user, "EDIT_POSTED") };

  return (
    <div>
      <PageHeader
        title={`Ledger · ${scope.entity.code} ${scope.year.year}`}
        helper="Every transaction of this business in this year, one row each. Click a row and press Enter for the journal lines, notes and history; use the row menu or the keyboard to edit, split, post or void."
      />
      <LedgerGrid
        rows={rows}
        picker={picker}
        scope={{
          entityId: scope.entity.id,
          entityCode: scope.entity.code,
          year: scope.year.year,
          yearState: taxYear?.state ?? scope.year.state,
          overrideCount: taxYear?.overrideCount ?? 0,
        }}
        views={views}
        can={can}
      />
    </div>
  );
}
