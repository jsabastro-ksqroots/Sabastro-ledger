"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LedgerRow, PickerData } from "@/lib/ledger/query";
import { formatCents } from "@/lib/money";
import { createBankTransactionAction, updateBankTransactionAction } from "@/server/actions/ledger";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AccountSelect, BankAccountSelect, ClassSelect } from "./pickers";
import { useLockedYearFlow } from "./lock-override-dialog";

/**
 * The "simple row": date · vendor · amount (signed) · account · class · bank account · memo · note.
 * Creates a bank-centric transaction (as a draft or posted) or edits an existing one. For a split row
 * the amount/account/class are locked; the lines are edited one by one from the details panel.
 */
export function TransactionDialog({
  open,
  onOpenChange,
  picker,
  defaultBankAccountId,
  defaultYear,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  picker: PickerData;
  defaultBankAccountId: string | null;
  defaultYear: number;
  /** When given, the dialog edits this row. */
  row?: LedgerRow | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {row ? `Edit #${row.seq} ${row.vendor ?? ""}` : "New transaction"}
          </DialogTitle>
          <DialogDescription>
            {row
              ? "Changes replace the old journal lines and keep them in the history."
              : "Enter it the way the bank shows it: money out is negative, money in is positive. The app writes the two journal lines for you."}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <TransactionForm
            picker={picker}
            defaultBankAccountId={defaultBankAccountId}
            defaultYear={defaultYear}
            row={row ?? null}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function todayInYear(year: number): string {
  const now = new Date();
  if (now.getFullYear() === year) return now.toISOString().slice(0, 10);
  return `${year}-12-31`;
}

function TransactionForm({
  picker,
  defaultBankAccountId,
  defaultYear,
  row,
  onDone,
}: {
  picker: PickerData;
  defaultBankAccountId: string | null;
  defaultYear: number;
  row: LedgerRow | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const { call, overrideDialog } = useLockedYearFlow();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(row?.date ?? todayInYear(defaultYear));
  const [vendor, setVendor] = useState(row?.vendor ?? "");
  const [amount, setAmount] = useState(
    row?.amountCents !== null && row?.amountCents !== undefined
      ? formatCents(BigInt(row.amountCents), { negative: "minus" }).replace(/,/g, "")
      : "",
  );
  const [bankAccountId, setBankAccountId] = useState(
    row?.bankAccountId ?? defaultBankAccountId ?? "",
  );
  const [accountId, setAccountId] = useState(row?.accountId ?? "");
  const [classId, setClassId] = useState(row?.classId ?? "");
  const [memo, setMemo] = useState(row?.memo ?? "");
  const [userNote, setUserNote] = useState("");
  const locked = !!row && row.isSplit;
  const bank = picker.bankAccounts.find((b) => b.id === bankAccountId) ?? null;

  const submit = (post: boolean) =>
    start(async () => {
      setError(null);
      const result = await call((lockOverrideReason) =>
        row
          ? updateBankTransactionAction({
              id: row.id,
              date,
              vendor,
              memo,
              bankAccountId: bankAccountId || undefined,
              ...(locked ? {} : { amount, accountId, classId }),
              lockOverrideReason,
            })
          : createBankTransactionAction({
              bankAccountId,
              date,
              vendor,
              amount,
              accountId,
              classId,
              memo,
              userNote,
              post: post ? "true" : "false",
              lockOverrideReason,
            }),
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
      onDone();
    });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(true);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <div className="space-y-2">
          <Label htmlFor="tx-date">Date</Label>
          <Input
            id="tx-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="tabular"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tx-vendor">Vendor / payee</Label>
          <Input
            id="tx-vendor"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="Lowes, PECO, Tenant name…"
            required
            maxLength={200}
            autoFocus
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <div className="space-y-2">
          <Label htmlFor="tx-amount">Amount</Label>
          <Input
            id="tx-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="-135.15"
            inputMode="decimal"
            required={!locked}
            disabled={locked}
            className="tabular text-right"
          />
          <p className="text-muted-foreground text-xs">
            {locked
              ? `Split into ${row?.userLineCount} lines; unsplit to change the amount.`
              : "Negative = money out of the bank. Positive = money in."}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="tx-bank">Bank account</Label>
          <BankAccountSelect
            id="tx-bank"
            bankAccounts={picker.bankAccounts}
            value={bankAccountId}
            onChange={setBankAccountId}
          />
          <p className="text-muted-foreground text-xs">
            {bank
              ? `This row belongs to ${bank.entityCode}'s books.`
              : "Which account the money moved through."}
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="tx-account">Account</Label>
          <AccountSelect
            id="tx-account"
            accounts={picker.accounts}
            value={accountId}
            onChange={setAccountId}
            disabled={locked}
            excludeAccountId={bank?.accountId ?? null}
            bankGroupLabel="Bank accounts (only for a transfer between your own accounts)"
          />
          <p className="text-muted-foreground text-xs">
            Where the money went or came from: an expense, income, asset, liability or equity
            account. Pick a bank account only to record a transfer between your own accounts.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="tx-class">Class</Label>
          <ClassSelect
            id="tx-class"
            classes={picker.classes}
            value={classId}
            onChange={setClassId}
            disabled={locked}
          />
          <p className="text-muted-foreground text-xs">
            A class of the other business adds the bridge lines automatically.
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="tx-memo">
          Memo <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          id="tx-memo"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="Bank description, check number, what it was for"
          maxLength={2000}
        />
      </div>
      {!row ? (
        <div className="space-y-2">
          <Label htmlFor="tx-note">
            Your note <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Textarea
            id="tx-note"
            value={userNote}
            onChange={(e) => setUserNote(e.target.value)}
            rows={2}
            placeholder="Anything Jose or you should remember about this one"
          />
        </div>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        {!row ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => submit(false)}
            disabled={pending}
          >
            Save as draft
          </Button>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : row ? "Save changes" : "Save and post"}
        </Button>
      </DialogFooter>
      {overrideDialog}
    </form>
  );
}
