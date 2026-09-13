"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LedgerRow } from "@/lib/ledger/query";
import { formatCents } from "@/lib/money";
import { postTransactionAction, voidTransactionAction } from "@/server/actions/ledger";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLockedYearFlow } from "./lock-override-dialog";

/** Void with a typed reason. Nothing is deleted: the transaction stays in the ledger marked Voided. */
export function VoidDialog({
  open,
  onOpenChange,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: LedgerRow;
}) {
  const router = useRouter();
  const { call, overrideDialog } = useLockedYearFlow();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Void #{row.seq} {row.vendor ?? ""}?
          </DialogTitle>
          <DialogDescription>
            {formatCents(BigInt(row.amountCents ?? row.totalCents), { symbol: true })} leaves every
            report and total, but the transaction and its lines stay in the ledger marked Voided,
            with your reason. This cannot be undone; enter a new transaction if it was right after
            all.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="void-reason">Reason</Label>
          <Textarea
            id="void-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Duplicate of #123 / wrong bank account / entered twice"
          />
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
            Keep it
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending || reason.trim().length < 3}
            onClick={() =>
              start(async () => {
                setError(null);
                const result = await call((lockOverrideReason) =>
                  voidTransactionAction({ id: row.id, reason, lockOverrideReason }),
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
            {pending ? "Voiding…" : "Void transaction"}
          </Button>
        </DialogFooter>
        {overrideDialog}
      </DialogContent>
    </Dialog>
  );
}

/** Confirm (post) a draft or flagged transaction from the ledger. */
export function PostDialog({
  open,
  onOpenChange,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: LedgerRow;
}) {
  const router = useRouter();
  const { call, overrideDialog } = useLockedYearFlow();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Post #{row.seq} {row.vendor ?? ""}?
          </DialogTitle>
          <DialogDescription>
            Posting puts {formatCents(BigInt(row.amountCents ?? row.totalCents), { symbol: true })}{" "}
            into the books and every report. It can still be edited afterwards, with a full audit
            trail.
          </DialogDescription>
        </DialogHeader>
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
            Not yet
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const result = await call((lockOverrideReason) =>
                  postTransactionAction({ id: row.id, lockOverrideReason }),
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
            {pending ? "Posting…" : "Post"}
          </Button>
        </DialogFooter>
        {overrideDialog}
      </DialogContent>
    </Dialog>
  );
}
