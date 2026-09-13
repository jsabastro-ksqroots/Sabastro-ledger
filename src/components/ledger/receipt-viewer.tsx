"use client";

import { FileImage } from "lucide-react";
import type { LedgerRow } from "@/lib/ledger/query";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusChip } from "@/components/status-chip";

/**
 * The receipt viewer: image or PDF on the left, the transaction summary on the right. Phase 3 wires the
 * real files (DigitalOcean Spaces, signed URLs); until then this is the placeholder the ledger row opens.
 */
export function ReceiptViewerDialog({
  open,
  onOpenChange,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: LedgerRow;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            Receipts for #{row.seq} {row.vendor ?? ""}
          </DialogTitle>
          <DialogDescription>
            {row.receiptCount === 0
              ? row.receiptExpectedCount > 0
                ? `${row.receiptExpectedCount} receipt${row.receiptExpectedCount === 1 ? "" : "s"} on file in the old workbook; the files arrive with the Phase 3 import.`
                : "No receipt is attached to this transaction yet."
              : `${row.receiptCount} receipt${row.receiptCount === 1 ? "" : "s"} attached.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_18rem]">
          <div className="bg-muted/40 text-muted-foreground flex min-h-72 flex-col items-center justify-center rounded-md border border-dashed p-6 text-center text-sm">
            <FileImage className="mb-3 h-10 w-10" aria-hidden />
            <div className="font-medium">Receipt viewer</div>
            <p className="mt-1 max-w-sm">
              Images and PDFs will show here with zoom once receipt upload is built (Phase 3).
              Several receipts per transaction, and one receipt covering several transactions, are
              both supported.
            </p>
          </div>
          <dl className="space-y-2 text-sm">
            <Item label="Date">{formatDate(row.date)}</Item>
            <Item label="Vendor">{row.vendor ?? "—"}</Item>
            <Item label="Amount">
              <span className="tabular">
                {formatCents(BigInt(row.amountCents ?? row.totalCents), { symbol: true })}
              </span>
            </Item>
            <Item label="Account">{row.accountLabel}</Item>
            <Item label="Class">{row.classLabel}</Item>
            <Item label="Bank">{row.bankLabel ?? "—"}</Item>
            <Item label="Status">
              <StatusChip status={row.status} />
            </Item>
            {row.memo ? <Item label="Memo">{row.memo}</Item> : null}
          </dl>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
