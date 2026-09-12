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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { setBankAccountActiveAction, type EntityActionState } from "@/server/actions/entities";

/** Deactivate (with a one-sentence confirmation) or reactivate a bank account. */
export function BankAccountActiveButton({
  id,
  label,
  isActive,
}: {
  id: string;
  label: string;
  isActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!isActive) {
    return (
      <ActiveForm
        id={id}
        isActive
        onDone={() => undefined}
        label="Reactivate"
        pendingLabel="Reactivating…"
        variant="outline"
      />
    );
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          Deactivate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deactivate {label}?</DialogTitle>
          <DialogDescription>
            It will no longer be offered for new transactions or statements; everything already
            posted to it stays exactly as it is, and you can reactivate it any time.
          </DialogDescription>
        </DialogHeader>
        <ActiveForm
          id={id}
          isActive={false}
          onDone={() => setOpen(false)}
          label="Deactivate"
          pendingLabel="Deactivating…"
          variant="destructive"
          cancel
        />
      </DialogContent>
    </Dialog>
  );
}

function ActiveForm({
  id,
  isActive,
  onDone,
  label,
  pendingLabel,
  variant,
  cancel,
}: {
  id: string;
  isActive: boolean;
  onDone: () => void;
  label: string;
  pendingLabel: string;
  variant: "outline" | "destructive";
  cancel?: boolean;
}) {
  const [state, action, pending] = useActionState<EntityActionState, FormData>(
    setBankAccountActiveAction,
    {},
  );
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);
  return (
    <form action={action} className={cancel ? "space-y-4" : "inline"}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="isActive" value={isActive ? "true" : "false"} />
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {cancel ? (
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant={variant} disabled={pending}>
            {pending ? pendingLabel : label}
          </Button>
        </DialogFooter>
      ) : (
        <Button type="submit" variant={variant} size="sm" disabled={pending}>
          {pending ? pendingLabel : label}
        </Button>
      )}
    </form>
  );
}
