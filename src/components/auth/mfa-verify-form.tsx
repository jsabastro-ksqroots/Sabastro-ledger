"use client";

import { useActionState, useState } from "react";
import { signOutAction, verifyMfaAction, type MfaState } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function MfaVerifyForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<MfaState, FormData>(verifyMfaAction, {});
  const [useRecovery, setUseRecovery] = useState(false);
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        {useRecovery ? (
          <div className="space-y-2">
            <Label htmlFor="recovery">Recovery code</Label>
            <Input
              id="recovery"
              name="recovery"
              autoComplete="off"
              placeholder="XXXXX-XXXXX"
              required
              autoFocus
              className="font-mono tracking-wider"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="code">6-digit code</Label>
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
        )}
        {state.error ? (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Checking…" : "Sign in"}
        </Button>
      </form>
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          className="text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => setUseRecovery((v) => !v)}
        >
          {useRecovery
            ? "Use my authenticator app instead"
            : "Lost your phone? Use a recovery code"}
        </button>
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-muted-foreground underline-offset-4 hover:underline"
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
