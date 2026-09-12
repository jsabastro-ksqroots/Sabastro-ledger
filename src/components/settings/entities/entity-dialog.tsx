"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  createEntityAction,
  updateEntityAction,
  type EntityActionState,
} from "@/server/actions/entities";
import { TAX_FORM_LABELS, TAX_FORMS } from "@/lib/org/entities";
import { FormSelect } from "./form-select";

export interface EntityFormData {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  taxForm: string;
  isActive: boolean;
}

const TAX_FORM_OPTIONS = TAX_FORMS.map((value) => ({ value, label: TAX_FORM_LABELS[value] }));

/** "Add entity" (no `entity`) or "Edit" (with `entity`). The form remounts every time the dialog opens, so its state starts fresh. */
export function EntityDialog({
  entity,
  trigger,
}: {
  entity?: EntityFormData;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entity ? `Edit ${entity.code}` : "Add entity"}</DialogTitle>
          <DialogDescription>
            {entity
              ? "The short code cannot change; it is how the books refer to this entity everywhere."
              : "An entity is a business that files its own return. 544 Liberty and 176 Tulsk are classes under SREI, not entities, so this is rarely needed."}
          </DialogDescription>
        </DialogHeader>
        <EntityForm entity={entity} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function EntityForm({ entity, onDone }: { entity?: EntityFormData; onDone: () => void }) {
  const [state, action, pending] = useActionState<EntityActionState, FormData>(
    entity ? updateEntityAction : createEntityAction,
    {},
  );
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);
  return (
    <form action={action} className="space-y-4">
      {entity ? <input type="hidden" name="id" value={entity.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <div className="space-y-2">
          <Label htmlFor="entity-code">Short code</Label>
          <Input
            id="entity-code"
            name="code"
            defaultValue={entity?.code ?? ""}
            disabled={!!entity}
            placeholder="SREI"
            maxLength={8}
            className="uppercase"
            required={!entity}
            autoFocus={!entity}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="entity-name">Name</Label>
          <Input
            id="entity-name"
            name="name"
            defaultValue={entity?.name ?? ""}
            placeholder="Sabastro Real Estate Investments"
            required
            autoFocus={!!entity}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="entity-legal">Legal name</Label>
        <Input
          id="entity-legal"
          name="legalName"
          defaultValue={entity?.legalName ?? ""}
          placeholder="Sabastro Real Estate Investments LLC"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="entity-tax-form">Tax form</Label>
        <FormSelect
          id="entity-tax-form"
          name="taxForm"
          options={TAX_FORM_OPTIONS}
          defaultValue={entity?.taxForm ?? "FORM_1065"}
        />
      </div>
      {entity ? (
        <div className="flex items-start gap-2">
          <Checkbox id="entity-active" name="isActive" defaultChecked={entity.isActive} />
          <div className="grid gap-1">
            <Label htmlFor="entity-active">Active</Label>
            <p className="text-muted-foreground text-xs">
              An inactive entity disappears from the entity switcher. Its bank accounts and classes
              must be deactivated first.
            </p>
          </div>
        </div>
      ) : null}
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
          {pending ? "Saving…" : entity ? "Save changes" : "Add entity"}
        </Button>
      </DialogFooter>
    </form>
  );
}
