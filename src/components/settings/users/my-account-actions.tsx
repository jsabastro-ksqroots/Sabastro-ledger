"use client";

import { useActionState, useCallback, useState } from "react";
import {
  changeOwnPasswordAction,
  regenerateRecoveryCodesAction,
  type RecoveryCodesState,
} from "@/server/actions/users";
import { signOutEverywhereAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ActionForm } from "./action-form";

type Which = "password" | "codes" | "signout" | null;

export function MyAccountActions({ liveSessions }: { liveSessions: number }) {
  const [open, setOpen] = useState<Which>(null);
  const close = useCallback(() => setOpen(null), []);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen("password")}>
          Change my password
        </Button>
        <Button variant="outline" size="sm" onClick={() => setOpen("codes")}>
          Generate new recovery codes
        </Button>
        <Button variant="outline" size="sm" onClick={() => setOpen("signout")}>
          Sign out everywhere
        </Button>
      </div>

      <Dialog open={open === "password"} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change my password</DialogTitle>
            <DialogDescription>
              At least 12 characters with upper- and lower-case letters and a number. Any other
              device you are signed in on will be signed out.
            </DialogDescription>
          </DialogHeader>
          <ActionForm action={changeOwnPasswordAction} onDone={close} submitLabel="Change password">
            <div className="space-y-2">
              <Label htmlFor="own-password">New password</Label>
              <Input
                id="own-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="own-confirm">New password again</Label>
              <Input
                id="own-confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
              />
            </div>
          </ActionForm>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "codes"} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <RecoveryCodesDialogBody />
        </DialogContent>
      </Dialog>

      <Dialog open={open === "signout"} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out everywhere</DialogTitle>
            <DialogDescription>
              This ends{" "}
              {liveSessions === 1
                ? "your only open session"
                : `all ${liveSessions} of your open sessions`}
              , including this one. You will be taken to the sign-in page.
            </DialogDescription>
          </DialogHeader>
          <form action={signOutEverywhereAction}>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit">Sign out everywhere</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RecoveryCodesDialogBody() {
  const [state, action, pending] = useActionState<RecoveryCodesState, FormData>(
    regenerateRecoveryCodesAction,
    {},
  );
  const [copied, setCopied] = useState(false);
  if (state.codes) {
    const codes = state.codes;
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(codes.join("\n"));
        setCopied(true);
      } catch {
        setCopied(false);
      }
    };
    return (
      <>
        <DialogHeader>
          <DialogTitle>Your new recovery codes</DialogTitle>
          <DialogDescription>
            Each code works once, if you ever lose your phone. They will not be shown again — save
            them somewhere safe now.
          </DialogDescription>
        </DialogHeader>
        <ul className="bg-muted/40 grid grid-cols-2 gap-2 rounded border p-4 font-mono text-sm">
          {codes.map((code) => (
            <li key={code} className="select-all">
              {code}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={copy}>
            {copied ? "Copied" : "Copy all"}
          </Button>
          <DialogClose asChild>
            <Button type="button">I have saved them</Button>
          </DialogClose>
        </DialogFooter>
      </>
    );
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>Generate new recovery codes</DialogTitle>
        <DialogDescription>
          You get ten fresh codes and every old code stops working immediately. Do this if you have
          used most of your codes or are not sure where they are.
        </DialogDescription>
      </DialogHeader>
      <form action={action} className="space-y-4">
        {state.error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not generate codes</AlertTitle>
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" disabled={pending}>
            {pending ? "Generating…" : "Generate new codes"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
