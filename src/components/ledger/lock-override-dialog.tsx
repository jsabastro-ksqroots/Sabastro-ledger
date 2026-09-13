"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, Lock } from "lucide-react";
import type { LockedYear } from "@/lib/ledger/errors";
import type { LedgerResult } from "@/server/actions/ledger";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * The full-screen warning for a closed or filed tax year (CLAUDE.md "Tax years"). The wording escalates
 * for filed years. A typed reason is required; the server records it as an audited override.
 */
export function LockOverrideDialog({
  years,
  onConfirm,
  onCancel,
  pending,
  error,
}: {
  years: LockedYear[];
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  pending?: boolean;
  error?: string | null;
}) {
  const [reason, setReason] = useState("");
  const filed = years.some((y) => y.state === "FILED");
  const list = years.map((y) => `${y.entityCode} ${y.year} (${y.state.toLowerCase()})`).join(", ");
  const valid = reason.trim().length >= 5;
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-dvh w-screen max-w-none flex-col items-center justify-center gap-0 rounded-none border-0 p-0 sm:max-w-none"
      >
        <div
          className={
            filed
              ? "flex h-full w-full flex-col items-center justify-center bg-red-50 px-6 text-red-950"
              : "flex h-full w-full flex-col items-center justify-center bg-amber-50 px-6 text-amber-950"
          }
        >
          <div className="w-full max-w-xl">
            <div className="mb-6 flex items-center gap-3">
              {filed ? (
                <Lock className="h-10 w-10 shrink-0" aria-hidden />
              ) : (
                <AlertTriangle className="h-10 w-10 shrink-0" aria-hidden />
              )}
              <DialogTitle className="text-2xl leading-tight font-semibold">
                {filed ? "This year has been FILED." : "This tax year is closed."}
              </DialogTitle>
            </div>
            <p className="text-base leading-relaxed">
              {filed
                ? `The numbers for ${list} are on a tax return that has already been submitted. Changing them now means the return no longer matches the books, and an amended return may be needed.`
                : `The numbers for ${list} may already be on a filed return. Changing them now means the return may no longer match the books.`}
            </p>
            <p className="mt-3 text-base">
              Continue only if you are sure. Your reason is written to the Activity log as an
              override and the year shows an &quot;overridden&quot; badge from now on.
            </p>
            <div className="mt-6 space-y-2">
              <Label htmlFor="override-reason" className="text-base">
                Why is this change needed?
              </Label>
              <Textarea
                id="override-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                autoFocus
                placeholder="For example: found a missing receipt after the return was filed"
                className="bg-white text-base"
              />
              <p className="text-sm opacity-80">At least five characters.</p>
            </div>
            {error ? (
              <p className="mt-3 rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={onCancel}
                disabled={pending}
              >
                Go back, change nothing
              </Button>
              <Button
                type="button"
                size="lg"
                variant="destructive"
                disabled={!valid || pending}
                onClick={() => onConfirm(reason.trim())}
              >
                {pending ? "Recording override…" : "Continue and record the override"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Pending = {
  years: LockedYear[];
  retry: (reason: string) => Promise<LedgerResult>;
  resolve: (r: LedgerResult) => void;
};

/**
 * Wraps a ledger action so a `needsOverride` answer opens the full-screen warning and, once a reason is
 * typed, retries the same call with it. Use: `const { call, overrideDialog } = useLockedYearFlow()`.
 */
export function useLockedYearFlow() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    (fn: (lockOverrideReason?: string) => Promise<LedgerResult>): Promise<LedgerResult> =>
      fn().then((result) => {
        if (!result.needsOverride) return result;
        const years = result.needsOverride.years;
        return new Promise<LedgerResult>((resolve) => {
          setError(null);
          setPending({ years, retry: (reason) => fn(reason), resolve });
        });
      }),
    [],
  );

  const overrideDialog = pending ? (
    <LockOverrideDialog
      years={pending.years}
      pending={busy}
      error={error}
      onCancel={() => {
        pending.resolve({ error: "Nothing was changed." });
        setPending(null);
      }}
      onConfirm={async (reason) => {
        setBusy(true);
        try {
          const r = await pending.retry(reason);
          if (r.error) {
            setError(r.error);
            return;
          }
          pending.resolve(r);
          setPending(null);
        } finally {
          setBusy(false);
        }
      }}
    />
  ) : null;

  return { call, overrideDialog };
}
