import { BookOpenIcon } from "lucide-react";
import { db } from "@/lib/db";
import { requireFullSession } from "@/lib/auth/current-user";
import { hasFullAccess } from "@/lib/auth/permissions";
import {
  distinctParentGroups,
  isInferredAccount,
  listAccounts,
  subTypeSuggestions,
} from "@/lib/org/accounts";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";
import { AccountsToolbar } from "@/components/settings/accounts/accounts-toolbar";
import { AccountsTable } from "@/components/settings/accounts/accounts-table";
import { AccountDialog } from "@/components/settings/accounts/account-dialog";

export const metadata = { title: "Chart of accounts" };

export default async function AccountsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string }>;
}) {
  const params = await searchParams;
  const user = await requireFullSession("/settings/accounts");
  const canEdit = hasFullAccess(user.role);
  const search = (params.q ?? "").trim();
  const showInactive = params.inactive === "1";

  const [accounts, parentGroups, subTypes] = await Promise.all([
    listAccounts(db, { includeInactive: showInactive, search }),
    distinctParentGroups(db),
    subTypeSuggestions(db),
  ]);
  const suggestions = { parentGroups, subTypes: subTypes.subTypes, subTypes2: subTypes.subTypes2 };
  const inferredCount = accounts.filter(isInferredAccount).length;

  return (
    <div>
      <PageHeader
        title="Chart of accounts"
        helper="Account numbers are permanent identifiers — every posting refers to them — so an account that has been used can only be deactivated, never deleted or renumbered. Names, grouping and notes are free to edit."
        actions={canEdit ? <AccountDialog mode="create" suggestions={suggestions} /> : undefined}
      />
      {!canEdit ? (
        <p className="text-muted-foreground mb-4 text-sm">
          You can browse the chart but not change it — that takes Owner or Full access.
        </p>
      ) : null}
      {inferredCount > 0 ? (
        <p className="text-muted-foreground mb-4 text-sm">
          {inferredCount} {inferredCount === 1 ? "account was" : "accounts were"} added from the
          2025 ledger with an inferred grouping and type. They carry a “confirm with Jose” marker
          until the note is cleared.
        </p>
      ) : null}
      <AccountsToolbar search={search} showInactive={showInactive} />
      {accounts.length === 0 ? (
        <EmptyState
          icon={BookOpenIcon}
          title={search ? "No accounts match that search" : "No accounts yet"}
          description={
            search
              ? "Try a number, part of a name, or a word from the note. Inactive accounts only show when the box is ticked."
              : "The chart is seeded from seed/chart_of_accounts.csv the first time the app runs. Run the seed, or add an account here."
          }
        />
      ) : (
        <AccountsTable accounts={accounts} suggestions={suggestions} canEdit={canEdit} />
      )}
      <p className="text-muted-foreground tabular mt-3 text-xs">
        {accounts.length} {accounts.length === 1 ? "account" : "accounts"} shown
        {showInactive ? " (including inactive)" : ""}.
      </p>
    </div>
  );
}
