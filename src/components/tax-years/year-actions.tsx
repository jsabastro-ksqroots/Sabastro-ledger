"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import {
  closeTaxYearAction,
  fileTaxYearAction,
  reopenTaxYearAction,
} from "@/server/actions/tax-years";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

type Step = "close" | "file" | "reopen" | null;

export function YearActions({
  taxYearId,
  label,
  state,
  canClose,
  canCloseYear,
  isOwner,
}: {
  taxYearId: string;
  label: string;
  state: "OPEN" | "CLOSED" | "FILED";
  canClose: boolean;
  canCloseYear: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");

  const submit = () =>
    start(async () => {
      setError(null);
      const r =
        step === "close"
          ? await closeTaxYearAction({ taxYearId, note })
          : step === "file"
            ? await fileTaxYearAction({ taxYearId, note })
            : await reopenTaxYearAction({ taxYearId, reason });
      if (r.error) {
        setError(r.error);
        return;
      }
      setStep(null);
      setNote("");
      setReason("");
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Year state</CardTitle>
        <CardDescription>
          {state === "OPEN"
            ? "Open: normal editing. Close it when the numbers are handed to the return."
            : state === "CLOSED"
              ? "Closed: edits need a typed reason and are counted as overrides. Mark it filed once the return is submitted."
              : "Filed: the return is submitted. Only the Owner can re-open it, and that is recorded as an override."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {state === "OPEN" ? (
          <>
            <Button
              className="w-full"
              disabled={!canCloseYear || !canClose}
              onClick={() => setStep("close")}
              title={!canClose ? "Finish or override every checklist item first" : undefined}
            >
              <Lock /> Mark {label} closed
            </Button>
            {!canClose ? (
              <p className="text-muted-foreground text-xs">
                The checklist above must be complete first.
              </p>
            ) : null}
            {!canCloseYear ? (
              <p className="text-muted-foreground text-xs">
                Closing a year needs the “Close and file tax years” permission.
              </p>
            ) : null}
          </>
        ) : null}
        {state === "CLOSED" ? (
          <Button className="w-full" disabled={!canCloseYear} onClick={() => setStep("file")}>
            Mark {label} filed
          </Button>
        ) : null}
        {state !== "OPEN" ? (
          <Button
            variant="outline"
            className="w-full"
            disabled={!isOwner}
            onClick={() => setStep("reopen")}
            title={!isOwner ? "Only the Owner can re-open a year" : undefined}
          >
            Re-open {label}…
          </Button>
        ) : null}
        {!isOwner && state !== "OPEN" ? (
          <p className="text-muted-foreground text-xs">
            Only the Owner (Jose) can re-open a closed or filed year.
          </p>
        ) : null}
      </CardContent>

      {step ? (
        <Dialog open onOpenChange={(o) => !o && setStep(null)}>
          <DialogContent className={step === "reopen" ? "border-red-300" : undefined}>
            <DialogHeader>
              <DialogTitle>
                {step === "close"
                  ? `Close ${label}?`
                  : step === "file"
                    ? `Mark ${label} as filed?`
                    : `Re-open ${label}?`}
              </DialogTitle>
              <DialogDescription>
                {step === "close"
                  ? "From now on, every change dated in this year shows the full-screen warning, needs a typed reason, and is counted as an override on the year and in reports."
                  : step === "file"
                    ? "This says the tax return has been submitted with these numbers. The warning wording escalates to “This year has been FILED”. The return PDF can be attached in Phase 6."
                    : "The year goes back to open editing. This is itself recorded as an override: the count and the documents stay, and closing again runs the checklist again."}
              </DialogDescription>
            </DialogHeader>
            {step === "reopen" ? (
              <div className="space-y-2">
                <Label htmlFor="reopen-reason">Reason</Label>
                <Textarea
                  id="reopen-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  autoFocus
                  placeholder="Amended return needed because…"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="year-note">
                  Note <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="year-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    step === "close" ? "Numbers handed to TurboTax on …" : "Return e-filed on …"
                  }
                  maxLength={1000}
                />
              </div>
            )}
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(null)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant={step === "reopen" ? "destructive" : "default"}
                disabled={pending || (step === "reopen" && reason.trim().length < 5)}
                onClick={submit}
              >
                {pending
                  ? "Working…"
                  : step === "close"
                    ? "Close the year"
                    : step === "file"
                      ? "Mark filed"
                      : "Re-open and record override"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  );
}
