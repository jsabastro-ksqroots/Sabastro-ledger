"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { upsertBridgeRuleAction, type EntityActionState } from "@/server/actions/entities";
import { BRIDGE_MODE_LABELS, BRIDGE_MODES } from "@/lib/org/entities";
import { FormSelect } from "./form-select";

export interface BridgeAccountChoice {
  id: string;
  number: string;
  name: string;
  type: string;
}

export interface BridgeRuleFormData {
  mode: string;
  payerAccountId: string;
  receiverAccountId: string;
}

const MODE_OPTIONS = BRIDGE_MODES.map((value) => ({ value, label: BRIDGE_MODE_LABELS[value] }));

export function BridgeRuleDialog({
  payer,
  receiver,
  accounts,
  rule,
  trigger,
}: {
  payer: { id: string; code: string };
  receiver: { id: string; code: string };
  accounts: BridgeAccountChoice[];
  rule?: BridgeRuleFormData;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {payer.code} pays for {receiver.code}
          </DialogTitle>
          <DialogDescription>
            When {payer.code}&apos;s bank pays for something that belongs to {receiver.code}, the
            app adds two extra lines so each business balances on its own. Choose which accounts
            those lines use.
          </DialogDescription>
        </DialogHeader>
        <BridgeRuleForm
          payer={payer}
          receiver={receiver}
          accounts={accounts}
          rule={rule}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function BridgeRuleForm({
  payer,
  receiver,
  accounts,
  rule,
  onDone,
}: {
  payer: { id: string; code: string };
  receiver: { id: string; code: string };
  accounts: BridgeAccountChoice[];
  rule?: BridgeRuleFormData;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<EntityActionState, FormData>(
    upsertBridgeRuleAction,
    {},
  );
  const [mode, setMode] = useState(rule?.mode ?? "DISTRIBUTION_CONTRIBUTION");
  const defaults = useMemo(() => {
    const byNumber = (n: string) => accounts.find((a) => a.number === n)?.id ?? "";
    return {
      payer: rule?.payerAccountId ?? byNumber("3102"),
      receiver: rule?.receiverAccountId ?? byNumber("3101"),
    };
  }, [accounts, rule]);
  const [payerAccountId, setPayerAccountId] = useState(defaults.payer);
  const [receiverAccountId, setReceiverAccountId] = useState(defaults.receiver);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  const equityOnly = mode === "DISTRIBUTION_CONTRIBUTION";
  const choices = useMemo(
    () =>
      accounts
        .filter((a) => !equityOnly || a.type === "EQUITY")
        .map((a) => ({ value: a.id, label: `${a.number} ${a.name}` })),
    [accounts, equityOnly],
  );
  const valid = new Set(choices.map((c) => c.value));

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="payerEntityId" value={payer.id} />
      <input type="hidden" name="receiverEntityId" value={receiver.id} />
      <div className="space-y-2">
        <Label htmlFor="bridge-mode">How the payment is bridged</Label>
        <FormSelect
          id="bridge-mode"
          name="mode"
          options={MODE_OPTIONS}
          value={mode}
          onValueChange={setMode}
        />
        <p className="text-muted-foreground text-xs">
          {equityOnly
            ? "The money moved through Jose, who owns both businesses: the payer records a capital distribution, the receiver a capital contribution. Both accounts must be equity accounts."
            : "One business owes the other: the payer records a receivable (due from), the receiver a payable (due to). Any active account can be chosen."}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="bridge-payer-account">{payer.code} line (the payer)</Label>
        <FormSelect
          id="bridge-payer-account"
          name="payerAccountId"
          options={choices}
          placeholder="Pick an account"
          value={valid.has(payerAccountId) ? payerAccountId : ""}
          onValueChange={setPayerAccountId}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bridge-receiver-account">{receiver.code} line (the receiver)</Label>
        <FormSelect
          id="bridge-receiver-account"
          name="receiverAccountId"
          options={choices}
          placeholder="Pick an account"
          value={valid.has(receiverAccountId) ? receiverAccountId : ""}
          onValueChange={setReceiverAccountId}
        />
      </div>
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save rule"}
        </Button>
      </DialogFooter>
    </form>
  );
}
