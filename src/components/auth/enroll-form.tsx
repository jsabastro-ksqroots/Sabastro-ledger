"use client";

import Link from "next/link";
import { useActionState } from "react";
import { confirmEnrollmentAction, type EnrollState } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function EnrollForm() {
  const [state, action, pending] = useActionState<EnrollState, FormData>(
    confirmEnrollmentAction,
    {},
  );
  if (state.recoveryCodes) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertTitle>Authenticator set up. Save these recovery codes now.</AlertTitle>
          <AlertDescription>
            Each code works once, if you ever lose your phone. They will not be shown again — print
            them or store them in a password manager.
          </AlertDescription>
        </Alert>
        <ul className="bg-muted/40 grid grid-cols-2 gap-2 rounded border p-4 font-mono text-sm">
          {state.recoveryCodes.map((code) => (
            <li key={code} className="select-all">
              {code}
            </li>
          ))}
        </ul>
        <Button asChild className="w-full">
          <Link href="/dashboard">I have saved my recovery codes — continue</Link>
        </Button>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="code">6-digit code from the app</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          pattern="[0-9 ]*"
          autoComplete="one-time-code"
          maxLength={7}
          required
          autoFocus
          className="font-mono text-lg tracking-widest"
        />
      </div>
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Checking…" : "Finish setup"}
      </Button>
    </form>
  );
}
