"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import type { LedgerRow, PickerData } from "@/lib/ledger/query";
import { formatCents, parseAmountToCents } from "@/lib/money";
import { saveJournalEntryAction } from "@/server/actions/ledger";
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

interface LineDraft {
  key: number;
  accountId: string;
  classId: string;
  debit: string;
  credit: string;
  memo: string;
}

let nextKey = 1;
const blank = (): LineDraft => ({
  key: nextKey++,
  accountId: "",
  classId: "",
  debit: "",
  credit: "",
  memo: "",
});

/**
 * Multi-line journal entry (depreciation, deposits, year-end reclassifications). Debits and credits
 * must balance; lines in another business's class are bridged automatically. "Adjusting" marks
 * year-end entries so reports and the year-end checklist can find them.
 */
export function JournalDialog({
  open,
  onOpenChange,
  picker,
  defaultEntityId,
  defaultYear,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  picker: PickerData;
  defaultEntityId: string;
  defaultYear: number;
  row?: LedgerRow | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{row ? `Edit journal entry #${row.seq}` : "New journal entry"}</DialogTitle>
          <DialogDescription>
            For entries that do not come straight from the bank: depreciation, security-deposit
            movements, reclassifications. Every line needs an account and a class; debits must equal
            credits.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <JournalForm
            picker={picker}
            defaultEntityId={defaultEntityId}
            defaultYear={defaultYear}
            row={row ?? null}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function fromRow(row: LedgerRow): LineDraft[] {
  return row.lines
    .filter((l) => !l.isBridge)
    .map((l) => ({
      key: nextKey++,
      accountId: l.accountId ?? "",
      classId: l.classId ?? "",
      debit: l.debitCents ? formatCents(BigInt(l.debitCents)).replace(/,/g, "") : "",
      credit: l.creditCents ? formatCents(BigInt(l.creditCents)).replace(/,/g, "") : "",
      memo: l.memo ?? "",
    }));
}

function JournalForm({
  picker,
  defaultEntityId,
  defaultYear,
  row,
  onDone,
}: {
  picker: PickerData;
  defaultEntityId: string;
  defaultYear: number;
  row: LedgerRow | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const { call, overrideDialog } = useLockedYearFlow();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [entityId, setEntityId] = useState(row?.entityId ?? defaultEntityId);
  const [date, setDate] = useState(row?.date ?? `${defaultYear}-12-31`);
  const [vendor, setVendor] = useState(row?.vendor ?? "");
  const [memo, setMemo] = useState(row?.memo ?? "");
  const [adjusting, setAdjusting] = useState(row ? row.kind === "ADJUSTING" : true);
  const [lines, setLines] = useState<LineDraft[]>(row ? fromRow(row) : [blank(), blank()]);

  const totals = useMemo(() => {
    let dr = 0n;
    let cr = 0n;
    for (const l of lines) {
      dr += parseAmountToCents(l.debit) ?? 0n;
      cr += parseAmountToCents(l.credit) ?? 0n;
    }
    return { dr, cr, diff: dr - cr };
  }, [lines]);

  const update = (key: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = (post: boolean) =>
    start(async () => {
      setError(null);
      const result = await call((lockOverrideReason) =>
        saveJournalEntryAction({
          id: row?.id,
          entityId,
          date,
          vendor,
          memo,
          adjusting,
          lines: lines.map((l) => ({
            accountId: l.accountId,
            classId: l.classId,
            debit: l.debit,
            credit: l.credit,
            memo: l.memo,
          })),
          post,
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
      <div className="grid gap-4 sm:grid-cols-[9rem_10rem_1fr]">
        <div className="space-y-2">
          <Label htmlFor="je-entity">Business</Label>
          <select
            id="je-entity"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            className={SELECT_CLASS}
          >
            {picker.entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.code}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="je-date">Date</Label>
          <Input
            id="je-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="tabular"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="je-vendor">Description</Label>
          <Input
            id="je-vendor"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="Depreciation 2025, Security deposit returned…"
            required
            maxLength={200}
            autoFocus
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <Label htmlFor="je-memo">
            Memo <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="je-memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={2000}
            placeholder="Source: TurboTax depreciation schedule"
          />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={adjusting}
            onChange={(e) => setAdjusting(e.target.checked)}
            className="accent-primary size-4"
          />
          Year-end adjusting entry
        </label>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Account</th>
              <th className="px-2 py-1.5 text-left font-medium">Class</th>
              <th className="w-32 px-2 py-1.5 text-right font-medium">Debit</th>
              <th className="w-32 px-2 py-1.5 text-right font-medium">Credit</th>
              <th className="px-2 py-1.5 text-left font-medium">Memo</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.key} className="border-t">
                <td className="p-1">
                  <AccountSelect
                    accounts={picker.accounts}
                    value={l.accountId}
                    onChange={(v) => update(l.key, { accountId: v })}
                    className={cn(SELECT_CLASS, "h-8")}
                  />
                </td>
                <td className="p-1">
                  <ClassSelect
                    classes={picker.classes}
                    value={l.classId}
                    onChange={(v) => update(l.key, { classId: v })}
                    className={cn(SELECT_CLASS, "h-8")}
                  />
                </td>
                <td className="p-1">
                  <Input
                    value={l.debit}
                    onChange={(e) =>
                      update(l.key, {
                        debit: e.target.value,
                        credit: e.target.value ? "" : l.credit,
                      })
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                    className="tabular h-8 text-right"
                    aria-label={`Line ${i + 1} debit`}
                  />
                </td>
                <td className="p-1">
                  <Input
                    value={l.credit}
                    onChange={(e) =>
                      update(l.key, {
                        credit: e.target.value,
                        debit: e.target.value ? "" : l.debit,
                      })
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                    className="tabular h-8 text-right"
                    aria-label={`Line ${i + 1} credit`}
                  />
                </td>
                <td className="p-1">
                  <Input
                    value={l.memo}
                    onChange={(e) => update(l.key, { memo: e.target.value })}
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
                    disabled={lines.length <= 2}
                    onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                  >
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-muted/30 border-t text-sm">
            <tr>
              <td className="px-2 py-1.5" colSpan={2}>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setLines((prev) => [...prev, blank()])}
                >
                  <Plus /> Add line
                </Button>
              </td>
              <td className="tabular px-2 py-1.5 text-right font-medium">
                {formatCents(totals.dr)}
              </td>
              <td className="tabular px-2 py-1.5 text-right font-medium">
                {formatCents(totals.cr)}
              </td>
              <td
                className={cn(
                  "px-2 py-1.5 text-xs",
                  totals.diff === 0n ? "text-emerald-700" : "text-amber-800",
                )}
                colSpan={2}
              >
                {totals.diff === 0n
                  ? "Balanced"
                  : `Out of balance by ${formatCents(totals.diff < 0n ? -totals.diff : totals.diff)}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

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
        <Button type="submit" disabled={pending || totals.diff !== 0n}>
          {pending ? "Saving…" : row ? "Save changes" : "Save and post"}
        </Button>
      </DialogFooter>
      {overrideDialog}
    </form>
  );
}
