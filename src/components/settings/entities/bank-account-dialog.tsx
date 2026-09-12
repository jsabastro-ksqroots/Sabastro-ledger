"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  createBankAccountAction,
  updateBankAccountAction,
  type EntityActionState,
} from "@/server/actions/entities";
import { BANK_KIND_LABELS, BANK_KINDS } from "@/lib/org/entities";
import { cn } from "@/lib/utils";
import { FormSelect } from "./form-select";

export interface UnlinkedAccount {
  id: string;
  number: string;
  name: string;
  isActive: boolean;
}

export interface BankAccountFormData {
  id: string;
  accountNumber: string;
  accountName: string;
  name: string;
  institution: string | null;
  kind: string;
  last4: string | null;
  openedOn: string | null;
  closedOn: string | null;
}

const KIND_OPTIONS = BANK_KINDS.map((value) => ({ value, label: BANK_KIND_LABELS[value] }));

/** "Add bank account" (pass `entityId`) or "Edit" (pass `bankAccount`). */
export function BankAccountDialog({
  entityId,
  entityCode,
  unlinked,
  bankAccount,
  trigger,
}: {
  entityId: string;
  entityCode: string;
  unlinked: UnlinkedAccount[];
  bankAccount?: BankAccountFormData;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {bankAccount
              ? `Edit ${bankAccount.accountNumber} ${bankAccount.name}`
              : `Add bank account to ${entityCode}`}
          </DialogTitle>
          <DialogDescription>
            {bankAccount
              ? `This bank account posts to ledger account ${bankAccount.accountNumber} ${bankAccount.accountName}; that link cannot change.`
              : "Every bank account (or cash app like Venmo) needs its own ledger account in the 1100 group. Link one that already exists or create a new one here."}
          </DialogDescription>
        </DialogHeader>
        <BankAccountForm
          entityId={entityId}
          unlinked={unlinked}
          bankAccount={bankAccount}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function BankAccountForm({
  entityId,
  unlinked,
  bankAccount,
  onDone,
}: {
  entityId: string;
  unlinked: UnlinkedAccount[];
  bankAccount?: BankAccountFormData;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<EntityActionState, FormData>(
    bankAccount ? updateBankAccountAction : createBankAccountAction,
    {},
  );
  const [linkMode, setLinkMode] = useState<"existing" | "new">(
    unlinked.length ? "existing" : "new",
  );
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);
  const unlinkedOptions = unlinked.map((a) => ({
    value: a.id,
    label: `${a.number} ${a.name}${a.isActive ? "" : " (inactive)"}`,
  }));
  return (
    <form action={action} className="space-y-4">
      {bankAccount ? (
        <input type="hidden" name="id" value={bankAccount.id} />
      ) : (
        <input type="hidden" name="entityId" value={entityId} />
      )}

      {!bankAccount ? (
        <fieldset className="space-y-3 rounded-md border p-3">
          <legend className="text-muted-foreground px-1 text-xs font-medium">Ledger account</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <LinkModeOption
              checked={linkMode === "existing"}
              onSelect={() => setLinkMode("existing")}
              value="existing"
              title="Link an existing one"
              hint={
                unlinked.length
                  ? `${unlinked.length} bank-type account${unlinked.length === 1 ? "" : "s"} not linked yet`
                  : "None free right now"
              }
              disabled={!unlinked.length}
            />
            <LinkModeOption
              checked={linkMode === "new"}
              onSelect={() => setLinkMode("new")}
              value="new"
              title="Create a new one"
              hint="A new 4-digit number in the 1100 group"
            />
          </div>
          {linkMode === "existing" ? (
            <div className="space-y-2">
              <Label htmlFor="bank-account-id">Ledger account</Label>
              <FormSelect
                id="bank-account-id"
                name="accountId"
                options={unlinkedOptions}
                placeholder="Pick a bank-type account"
                defaultValue={unlinkedOptions[0]?.value}
              />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
              <div className="space-y-2">
                <Label htmlFor="bank-new-number">Number</Label>
                <Input
                  id="bank-new-number"
                  name="newNumber"
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  placeholder="1105"
                  className="tabular"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank-new-name">Ledger account name</Label>
                <Input
                  id="bank-new-name"
                  name="newName"
                  placeholder="Bank of America Savings"
                  required
                />
              </div>
            </div>
          )}
        </fieldset>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="bank-name">Name</Label>
          <Input
            id="bank-name"
            name="name"
            defaultValue={bankAccount?.name ?? ""}
            placeholder="Real Estate"
            required
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bank-institution">Institution</Label>
          <Input
            id="bank-institution"
            name="institution"
            defaultValue={bankAccount?.institution ?? ""}
            placeholder="Bank of America"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bank-kind">Kind</Label>
          <FormSelect
            id="bank-kind"
            name="kind"
            options={KIND_OPTIONS}
            defaultValue={bankAccount?.kind ?? "CHECKING"}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bank-last4">Last 4 digits</Label>
          <Input
            id="bank-last4"
            name="last4"
            defaultValue={bankAccount?.last4 ?? ""}
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            placeholder="1735"
            className="tabular"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bank-opened">Opened on</Label>
          <Input
            id="bank-opened"
            name="openedOn"
            type="date"
            defaultValue={bankAccount?.openedOn ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bank-closed">Closed on</Label>
          <Input
            id="bank-closed"
            name="closedOn"
            type="date"
            defaultValue={bankAccount?.closedOn ?? ""}
          />
        </div>
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
          {pending ? "Saving…" : bankAccount ? "Save changes" : "Add bank account"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function LinkModeOption({
  checked,
  onSelect,
  value,
  title,
  hint,
  disabled,
}: {
  checked: boolean;
  onSelect: () => void;
  value: string;
  title: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm transition-colors",
        checked ? "border-primary bg-accent/40" : "hover:bg-accent/30",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input
        type="radio"
        name="linkMode"
        value={value}
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        className="accent-primary mt-1"
      />
      <span className="grid gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground text-xs">{hint}</span>
      </span>
    </label>
  );
}
