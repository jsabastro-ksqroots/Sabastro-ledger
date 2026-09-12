"use client";

import { useActionState, useEffect, useState } from "react";
import { setAccountActiveAction, type AccountFormState } from "@/server/actions/accounts";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Deactivate (with a one-sentence confirmation) or reactivate an account. */
export function AccountActiveButton({
  id,
  label,
  isActive,
}: {
  id: string;
  label: string;
  isActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="xs" className={isActive ? "text-muted-foreground" : ""}>
          {isActive ? "Deactivate" : "Reactivate"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isActive ? "Deactivate" : "Reactivate"} {label}?
          </DialogTitle>
          <DialogDescription>
            {isActive
              ? "The account disappears from pickers and new entries; anything already posted to it stays exactly as it is."
              : "The account becomes available again in pickers and new entries."}
          </DialogDescription>
        </DialogHeader>
        {open ? <ActiveForm id={id} isActive={isActive} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ActiveForm({
  id,
  isActive,
  onDone,
}: {
  id: string;
  isActive: boolean;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(
    setAccountActiveAction,
    {},
  );
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant={isActive ? "destructive" : "default"} disabled={pending}>
          {pending ? "Working…" : isActive ? "Deactivate" : "Reactivate"}
        </Button>
      </DialogFooter>
    </form>
  );
}
