"use client";

import { useActionState, useEffect } from "react";
import type { ActionState } from "@/server/actions/users";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";

/**
 * A small form for one server action inside a dialog: shows the action's error, closes the dialog on
 * success. Mount it only while the dialog is open so each opening starts with a clean state.
 */
export function ActionForm({
  action,
  onDone,
  submitLabel,
  pendingLabel = "Saving…",
  destructive = false,
  children,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  onDone: () => void;
  submitLabel: string;
  pendingLabel?: string;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);
  return (
    <form action={formAction} className="space-y-4">
      {children}
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
