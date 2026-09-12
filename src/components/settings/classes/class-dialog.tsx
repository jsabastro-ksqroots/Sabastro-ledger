"use client";

import { useActionState, useEffect, useState } from "react";
import { PlusIcon } from "lucide-react";
import {
  createClassAction,
  updateClassAction,
  type ClassFormState,
} from "@/server/actions/classes";
import { CLASS_KINDS, CLASS_KIND_LABELS, CLASS_NAME_PREFIXES } from "@/lib/org/classes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

export interface ClassFormValues {
  id?: string;
  name: string;
  entityId: string;
  entityCode: string;
  kind: string;
  isShared: boolean;
  isLegalEntity: boolean;
  legalEntityName: string;
  yearsNote: string;
  note: string;
  sortOrder: number;
}

export interface EntityOption {
  id: string;
  code: string;
  name: string;
}

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

/** Add or edit a class. The form mounts only while open so each opening starts clean. */
export function ClassDialog({
  mode,
  cls,
  entities,
  trigger,
}: {
  mode: "create" | "edit";
  cls?: ClassFormValues;
  entities: EntityOption[];
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <PlusIcon /> Add class
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add a class" : `Edit ${cls?.name}`}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "A class is a property or business line that every transaction line is tagged with, so reports can be split by it."
              : "Rename, regroup or annotate this class. Its business cannot be changed here."}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <ClassForm mode={mode} cls={cls} entities={entities} onDone={() => setOpen(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ClassForm({
  mode,
  cls,
  entities,
  onDone,
}: {
  mode: "create" | "edit";
  cls?: ClassFormValues;
  entities: EntityOption[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<ClassFormState, FormData>(
    mode === "create" ? createClassAction : updateClassAction,
    {},
  );
  const [isLegalEntity, setIsLegalEntity] = useState(cls?.isLegalEntity ?? false);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);
  const isGeneral = !!cls?.isShared;

  return (
    <form action={action} className="space-y-4">
      {cls?.id ? <input type="hidden" name="id" value={cls.id} /> : null}
      <div className="space-y-2">
        <Label htmlFor="class-name">Name</Label>
        <Input
          id="class-name"
          name="name"
          defaultValue={cls?.name ?? ""}
          required
          maxLength={120}
          autoFocus
          readOnly={isGeneral}
          placeholder="Rentals:12 Example Street"
        />
        <p className="text-muted-foreground text-xs">
          {isGeneral
            ? "“General” is the shared class every business uses; its name is fixed."
            : `Suggested pattern: “Group:Name” — ${CLASS_NAME_PREFIXES.map((p) => `${p}…`).join(", ")} — but any name works.`}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="class-entity">Business</Label>
          {mode === "create" ? (
            <select
              id="class-entity"
              name="entityId"
              defaultValue={entities[0]?.id ?? ""}
              className={SELECT_CLASS}
              required
            >
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code} · {e.name}
                </option>
              ))}
            </select>
          ) : (
            <>
              <Input id="class-entity" value={cls?.entityCode ?? ""} readOnly disabled />
              <p className="text-muted-foreground text-xs">
                Fixed here: moving a class to another business (or promoting it to its own) is a
                migration that re-points the class while keeping every line — see CLAUDE.md.
              </p>
            </>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="class-kind">Kind</Label>
          <select
            id="class-kind"
            name="kind"
            defaultValue={cls?.kind ?? "RENTAL"}
            className={SELECT_CLASS}
            disabled={isGeneral}
          >
            {CLASS_KINDS.map((k) => (
              <option key={k} value={k}>
                {CLASS_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          {isGeneral ? <input type="hidden" name="kind" value="GENERAL" /> : null}
        </div>
      </div>
      <div className="space-y-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isLegalEntity"
            className="border-input accent-primary size-4 rounded"
            checked={isLegalEntity}
            onChange={(e) => setIsLegalEntity(e.target.checked)}
            disabled={isGeneral}
          />
          This class is its own legal entity (an LLC tracked as a class, like 544 Liberty and 176
          Tulsk)
        </label>
        {isLegalEntity ? (
          <div className="space-y-2 pl-6">
            <Label htmlFor="class-legal-name">Legal entity name</Label>
            <Input
              id="class-legal-name"
              name="legalEntityName"
              defaultValue={cls?.legalEntityName ?? ""}
              placeholder="544 Liberty LLC"
              required
            />
          </div>
        ) : null}
      </div>
      <div className={`grid gap-4 ${mode === "edit" ? "sm:grid-cols-2" : ""}`}>
        <div className="space-y-2">
          <Label htmlFor="class-years">
            Years active <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="class-years"
            name="yearsNote"
            defaultValue={cls?.yearsNote ?? ""}
            placeholder="2021-2025"
            maxLength={60}
          />
        </div>
        {mode === "edit" ? (
          <div className="space-y-2">
            <Label htmlFor="class-sort">Sort order</Label>
            <Input
              id="class-sort"
              name="sortOrder"
              type="number"
              min={0}
              max={9999}
              step={1}
              defaultValue={cls?.sortOrder ?? 0}
              className="tabular"
            />
          </div>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="class-note">
          Note <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Textarea
          id="class-note"
          name="note"
          defaultValue={cls?.note ?? ""}
          rows={2}
          placeholder="What this property or line is, and anything a bookkeeper should know."
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
          {pending ? "Saving…" : mode === "create" ? "Add class" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}
