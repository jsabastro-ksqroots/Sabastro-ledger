"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { rerunImportAction, type ImportActionState } from "@/server/actions/import";

export function RerunImportForm({
  canRun,
  filesPresent,
}: {
  canRun: boolean;
  filesPresent: boolean;
}) {
  const [state, action, pending] = useActionState<ImportActionState, FormData>(
    rerunImportAction,
    {},
  );
  const disabled = !canRun || !filesPresent || pending;
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          name="dryRun"
          value="1"
          variant="outline"
          size="sm"
          disabled={disabled}
        >
          {pending ? "Working…" : "Check without writing (dry run)"}
        </Button>
        <Button type="submit" name="dryRun" value="0" size="sm" disabled={disabled}>
          {pending ? "Working…" : "Re-run import"}
        </Button>
        <span className="text-muted-foreground text-xs">
          {!filesPresent
            ? "Put both workbooks in data/source to enable these buttons."
            : !canRun
              ? "Only the Owner or a Full-access user can run the import."
              : "Safe to press any time: rows already in the ledger are skipped and every number is re-checked. Takes about a minute."}
        </span>
      </div>
      {state.error ? (
        <Alert variant="destructive">
          <AlertTitle>The import stopped</AlertTitle>
          <AlertDescription>
            {state.error}
            {state.runId ? <> The report for this run is in the list below.</> : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {state.ok && state.message ? (
        <Alert>
          <AlertTitle>Done</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
