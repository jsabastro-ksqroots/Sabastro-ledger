"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import type { LedgerLineView, LedgerRow, PickerData } from "@/lib/ledger/query";
import { computeSplit, parsePercentToBp, type SplitMode } from "@/lib/ledger/split";
import { formatCents, parseAmountToCents } from "@/lib/money";
import { splitLineAction, unsplitLineAction } from "@/server/actions/ledger";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { AccountSelect, ClassSelect, SELECT_CLASS } from "./pickers";
import { useLockedYearFlow } from "./lock-override-dialog";

interface PartDraft {
  key: number;
  accountId: string;
  classId: string;
  value: string;
  memo: string;
}

let nextKey = 1;

/**
 * Splits one account/class line into several that add up to it, by amount or by percentage. The same
 * component serves the ledger row and (from Phase 3) the review queue.
 */
export function SplitDialog({
  open,
  onOpenChange,
  picker,
  row,
  line,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  picker: PickerData;
  row: LedgerRow;
  /** The user line being split (the only one for an unsplit simple row). */
  line: LedgerLineView;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Split #{row.seq} {row.vendor ?? ""} ·{" "}
            {formatCents(BigInt(line.debitCents || line.creditCents), { symbol: true })}
          </DialogTitle>
          <DialogDescription>
            Divide {line.accountLabel} · {line.classLabel} across several accounts or classes. The
            parts must add up to the original to the cent; the bank line and any cross-entity bridge
            are redone automatically.
          </DialogDescription>
        </DialogHeader>
        {open ? <SplitForm picker={picker} line={line} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SplitForm({
  picker,
  line,
  onDone,
}: {
  picker: PickerData;
  line: LedgerLineView;
  onDone: () => void;
}) {
  const router = useRouter();
  const { call, overrideDialog } = useLockedYearFlow();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<SplitMode>("amount");
  const total = BigInt(line.debitCents || line.creditCents);
  const [parts, setParts] = useState<PartDraft[]>(() => [
    {
      key: nextKey++,
      accountId: line.accountId ?? "",
      classId: line.classId ?? "",
      value: "",
      memo: "",
    },
    { key: nextKey++, accountId: line.accountId ?? "", classId: "", value: "", memo: "" },
  ]);

  const preview = useMemo(() => {
    try {
      const computed = computeSplit(
        total,
        parts.map((p) => ({
          accountId: p.accountId || "?",
          classId: p.classId || "?",
          amountCents: mode === "amount" ? (parseAmountToCents(p.value) ?? 0n) : null,
          percentBp: mode === "percent" ? (parsePercentToBp(p.value) ?? 0) : null,
          memo: p.memo,
        })),
        mode,
      );
      return { ok: true as const, amounts: computed.map((c) => c.amountCents) };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  }, [parts, mode, total]);

  const allocated = parts.reduce((sum, p) => {
    if (mode === "amount") return sum + (parseAmountToCents(p.value) ?? 0n);
    return sum;
  }, 0n);
  const percentTotal = parts.reduce((sum, p) => sum + (parsePercentToBp(p.value) ?? 0), 0);

  const update = (key: number, patch: Partial<PartDraft>) =>
    setParts((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const submit = () =>
    start(async () => {
      setError(null);
      const result = await call((lockOverrideReason) =>
        splitLineAction({
          lineId: line.id,
          mode,
          parts: parts.map((p) => ({
            accountId: p.accountId,
            classId: p.classId,
            value: p.value,
            memo: p.memo,
          })),
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
        submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-4">
        <Label className="text-muted-foreground">Split by</Label>
        {(["amount", "percent"] as const).map((m) => (
          <label key={m} className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="split-mode"
              value={m}
              checked={mode === m}
              onChange={() => setMode(m)}
              className="accent-primary"
            />
            {m === "amount" ? "Amounts" : "Percentages"}
          </label>
        ))}
        <span className="text-muted-foreground ml-auto text-xs">
          {mode === "amount"
            ? `${formatCents(allocated)} of ${formatCents(total)} allocated`
            : `${(percentTotal / 100).toFixed(2)}% of 100.00%`}
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Account</th>
              <th className="px-2 py-1.5 text-left font-medium">Class</th>
              <th className="w-28 px-2 py-1.5 text-right font-medium">
                {mode === "amount" ? "Amount" : "%"}
              </th>
              <th className="w-28 px-2 py-1.5 text-right font-medium">Cents</th>
              <th className="px-2 py-1.5 text-left font-medium">Memo</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {parts.map((p, i) => (
              <tr key={p.key} className="border-t">
                <td className="p-1">
                  <AccountSelect
                    accounts={picker.accounts}
                    value={p.accountId}
                    onChange={(v) => update(p.key, { accountId: v })}
                    className={cn(SELECT_CLASS, "h-8")}
                  />
                </td>
                <td className="p-1">
                  <ClassSelect
                    classes={picker.classes}
                    value={p.classId}
                    onChange={(v) => update(p.key, { classId: v })}
                    className={cn(SELECT_CLASS, "h-8")}
                    autoFocus={i === 1}
                  />
                </td>
                <td className="p-1">
                  <Input
                    value={p.value}
                    onChange={(e) => update(p.key, { value: e.target.value })}
                    inputMode="decimal"
                    placeholder={mode === "amount" ? "60.00" : "33.33"}
                    className="tabular h-8 text-right"
                    aria-label={`Line ${i + 1} ${mode}`}
                  />
                </td>
                <td className="tabular text-muted-foreground px-2 text-right">
                  {preview.ok ? formatCents(preview.amounts[i] ?? 0n) : "—"}
                </td>
                <td className="p-1">
                  <Input
                    value={p.memo}
                    onChange={(e) => update(p.key, { memo: e.target.value })}
                    className="h-8"
                    maxLength={500}
                    aria-label={`Line ${i + 1} memo`}
                  />
                </td>
                <td className="p-1 text-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Remove line"
                    disabled={parts.length <= 2}
                    onClick={() => setParts((prev) => prev.filter((x) => x.key !== p.key))}
                  >
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-muted/30 border-t">
            <tr>
              <td className="px-2 py-1.5" colSpan={6}>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    setParts((prev) => [
                      ...prev,
                      {
                        key: nextKey++,
                        accountId: line.accountId ?? "",
                        classId: "",
                        value: "",
                        memo: "",
                      },
                    ])
                  }
                >
                  <Plus /> Add line
                </Button>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {!preview.ok && parts.some((p) => p.value) ? (
        <p className="text-xs text-amber-800">{preview.message}</p>
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
        <Button type="submit" disabled={pending || !preview.ok}>
          {pending ? "Splitting…" : `Split into ${parts.length} lines`}
        </Button>
      </DialogFooter>
      {overrideDialog}
    </form>
  );
}

/** Collapses a split back into one line on the account and class chosen. */
export function UnsplitDialog({
  open,
  onOpenChange,
  picker,
  row,
  parentLineId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  picker: PickerData;
  row: LedgerRow;
  parentLineId: string;
}) {
  const router = useRouter();
  const { call, overrideDialog } = useLockedYearFlow();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const first = row.lines.find((l) => !l.isDerived);
  const [accountId, setAccountId] = useState(first?.accountId ?? "");
  const [classId, setClassId] = useState(first?.classId ?? "");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unsplit #{row.seq}</DialogTitle>
          <DialogDescription>
            The {row.userLineCount} split lines become one line of{" "}
            {formatCents(BigInt(row.totalCents), { symbol: true })} again. Pick the account and
            class it should carry.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="unsplit-account">Account</Label>
            <AccountSelect
              id="unsplit-account"
              accounts={picker.accounts}
              value={accountId}
              onChange={setAccountId}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="unsplit-class">Class</Label>
            <ClassSelect
              id="unsplit-class"
              classes={picker.classes}
              value={classId}
              onChange={setClassId}
            />
          </div>
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || !accountId || !classId}
            onClick={() =>
              start(async () => {
                setError(null);
                const result = await call((lockOverrideReason) =>
                  unsplitLineAction({ parentLineId, accountId, classId, lockOverrideReason }),
                );
                if (result.error) {
                  setError(result.error);
                  return;
                }
                router.refresh();
                onOpenChange(false);
              })
            }
          >
            {pending ? "Working…" : "Unsplit"}
          </Button>
        </DialogFooter>
        {overrideDialog}
      </DialogContent>
    </Dialog>
  );
}
