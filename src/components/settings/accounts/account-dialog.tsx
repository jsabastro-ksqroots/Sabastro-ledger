"use client";

import { useActionState, useEffect, useState } from "react";
import { PlusIcon } from "lucide-react";
import {
  createAccountAction,
  updateAccountAction,
  type AccountFormState,
} from "@/server/actions/accounts";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS } from "@/lib/org/accounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export interface AccountFormValues {
  id?: string;
  number: string;
  name: string;
  parentGroup: string;
  type: string;
  subType: string;
  subType2: string;
  note: string;
}

export interface AccountSuggestions {
  parentGroups: string[];
  subTypes: string[];
  subTypes2: string[];
}

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Add or edit an account. The form is mounted only while the dialog is open, so every opening starts
 * with a clean action state; when the action succeeds the dialog closes and the page re-renders.
 */
export function AccountDialog({
  mode,
  account,
  suggestions,
  trigger,
}: {
  mode: "create" | "edit";
  account?: AccountFormValues;
  suggestions: AccountSuggestions;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <PlusIcon /> Add account
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add an account" : `Edit ${account?.number} ${account?.name}`}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Pick an unused 4-digit number. The number is permanent; everything else can be changed later."
              : "The number cannot change — it is how every posting refers to this account. Names and grouping are free to edit."}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <AccountForm
            mode={mode}
            account={account}
            suggestions={suggestions}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AccountForm({
  mode,
  account,
  suggestions,
  onDone,
}: {
  mode: "create" | "edit";
  account?: AccountFormValues;
  suggestions: AccountSuggestions;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(
    mode === "create" ? createAccountAction : updateAccountAction,
    {},
  );
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={action} className="space-y-4">
      {account?.id ? <input type="hidden" name="id" value={account.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <div className="space-y-2">
          <Label htmlFor="acct-number">Number</Label>
          <Input
            id="acct-number"
            name="number"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            placeholder="5228"
            defaultValue={account?.number ?? ""}
            disabled={mode === "edit"}
            required={mode === "create"}
            autoFocus={mode === "create"}
            className="tabular"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="acct-name">Name</Label>
          <Input
            id="acct-name"
            name="name"
            defaultValue={account?.name ?? ""}
            required
            maxLength={120}
            autoFocus={mode === "edit"}
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="acct-type">Type</Label>
          <select
            id="acct-type"
            name="type"
            defaultValue={account?.type ?? "EXPENSE"}
            className={SELECT_CLASS}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="acct-parent">Parent group</Label>
          <Input
            id="acct-parent"
            name="parentGroup"
            list="acct-parent-groups"
            defaultValue={account?.parentGroup ?? ""}
            placeholder="5200 Operating Expenses"
            required
          />
          <datalist id="acct-parent-groups">
            {suggestions.parentGroups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </div>
        <div className="space-y-2">
          <Label htmlFor="acct-subtype">Sub-type</Label>
          <Input
            id="acct-subtype"
            name="subType"
            list="acct-sub-types"
            defaultValue={account?.subType ?? ""}
            placeholder="Expense"
            required
          />
          <datalist id="acct-sub-types">
            {suggestions.subTypes.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div className="space-y-2">
          <Label htmlFor="acct-subtype2">
            Sub-type 2 <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="acct-subtype2"
            name="subType2"
            list="acct-sub-types-2"
            defaultValue={account?.subType2 ?? ""}
            placeholder="Defaults to the parent group's name"
          />
          <datalist id="acct-sub-types-2">
            {suggestions.subTypes2.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="acct-note">
          Note <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Textarea
          id="acct-note"
          name="note"
          defaultValue={account?.note ?? ""}
          rows={2}
          placeholder="When to use this account, or anything Jose should confirm."
        />
      </div>
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Add account" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}
