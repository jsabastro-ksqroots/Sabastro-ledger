import { AlertTriangleIcon } from "lucide-react";
import {
  ACCOUNT_TYPE_LABELS,
  accountLabel,
  isInferredAccount,
  type AccountRow,
  type AccountTypeKey,
} from "@/lib/org/accounts";
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
import { AccountDialog, type AccountSuggestions } from "./account-dialog";
import { AccountActiveButton } from "./account-active-button";

/** The chart, grouped by parent group with a header row per group. Server component. */
export function AccountsTable({
  accounts,
  suggestions,
  canEdit,
}: {
  accounts: AccountRow[];
  suggestions: AccountSuggestions;
  canEdit: boolean;
}) {
  const groups = new Map<string, AccountRow[]>();
  for (const a of accounts) {
    const list = groups.get(a.parentGroup) ?? [];
    list.push(a);
    groups.set(a.parentGroup, list);
  }
  const groupNames = [...groups.keys()].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const columns = canEdit ? 8 : 7;

  return (
    <div className="bg-card overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader className="bg-card sticky top-0">
          <TableRow>
            <TableHead className="w-20">Number</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="w-24">Type</TableHead>
            <TableHead className="w-40">Sub-type</TableHead>
            <TableHead className="w-44">Sub-type 2</TableHead>
            <TableHead className="w-24">Status</TableHead>
            <TableHead>Note</TableHead>
            {canEdit ? <TableHead className="w-40 text-right">Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {groupNames.map((group) => (
            <GroupRows
              key={group}
              group={group}
              rows={groups.get(group) ?? []}
              columns={columns}
              suggestions={suggestions}
              canEdit={canEdit}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function GroupRows({
  group,
  rows,
  columns,
  suggestions,
  canEdit,
}: {
  group: string;
  rows: AccountRow[];
  columns: number;
  suggestions: AccountSuggestions;
  canEdit: boolean;
}) {
  return (
    <>
      <TableRow className="bg-muted/50 hover:bg-muted/50">
        <TableCell
          colSpan={columns}
          className="text-muted-foreground py-1.5 text-xs font-semibold tracking-wide uppercase"
        >
          {group}
        </TableCell>
      </TableRow>
      {rows.map((a) => {
        const inferred = isInferredAccount(a);
        return (
          <TableRow key={a.id} className={a.isActive ? "" : "text-muted-foreground"}>
            <TableCell className="tabular font-medium">{a.number}</TableCell>
            <TableCell>
              <div className="flex flex-wrap items-center gap-2">
                <span>{a.name}</span>
                {a.bankAccount ? (
                  <span className="text-muted-foreground text-xs">bank · {a.bankAccount.name}</span>
                ) : null}
                {inferred ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-600/20 ring-inset"
                    title="The grouping and type of this account were inferred from the 2025 ledger. Ask Jose to confirm, then remove the note."
                  >
                    <AlertTriangleIcon className="size-3" aria-hidden /> confirm with Jose
                  </span>
                ) : null}
              </div>
            </TableCell>
            <TableCell>{ACCOUNT_TYPE_LABELS[a.type as AccountTypeKey] ?? a.type}</TableCell>
            <TableCell className="text-muted-foreground">{a.subType}</TableCell>
            <TableCell className="text-muted-foreground">{a.subType2}</TableCell>
            <TableCell>
              <StatusChip status={a.isActive ? "ACTIVE" : "INACTIVE"} />
            </TableCell>
            <TableCell className="max-w-[16rem]">
              {a.note ? (
                <span className="text-muted-foreground block truncate" title={a.note}>
                  {a.note}
                </span>
              ) : null}
            </TableCell>
            {canEdit ? (
              <TableCell className="text-right whitespace-nowrap">
                <AccountDialog
                  mode="edit"
                  suggestions={suggestions}
                  account={{
                    id: a.id,
                    number: a.number,
                    name: a.name,
                    parentGroup: a.parentGroup,
                    type: a.type,
                    subType: a.subType,
                    subType2: a.subType2,
                    note: a.note ?? "",
                  }}
                  trigger={
                    <Button variant="ghost" size="xs">
                      Edit
                    </Button>
                  }
                />
                <AccountActiveButton id={a.id} label={accountLabel(a)} isActive={a.isActive} />
              </TableCell>
            ) : null}
          </TableRow>
        );
      })}
    </>
  );
}
