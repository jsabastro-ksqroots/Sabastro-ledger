"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, ShieldAlert, Sparkles } from "lucide-react";
import type { ChecklistState } from "@/lib/ledger/tax-years";
import { setChecklistItemAction } from "@/server/actions/tax-years";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface ChecklistItemView {
  key: string;
  label: string;
  description: string;
  phase: string | null;
  state: ChecklistState;
  detail: string;
  doneAt: string | null;
  overrideReason: string | null;
}

export function YearChecklist({
  taxYearId,
  items,
  canEdit,
}: {
  taxYearId: string;
  items: ChecklistItemView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [overriding, setOverriding] = useState<ChecklistItemView | null>(null);
  const change = (key: string, done: boolean, overrideReason = "") =>
    start(async () => {
      setError(null);
      const r = await setChecklistItemAction({ taxYearId, itemKey: key, done, overrideReason });
      if (r.error) setError(r.error);
      else router.refresh();
    });
  return (
    <div className={cn("space-y-2", pending && "opacity-70")}>
      {items.map((item) => (
        <div key={item.key} className="flex items-start gap-3 rounded-md border px-3 py-2">
          <StateIcon state={item.state} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{item.label}</div>
            <div className="text-muted-foreground text-xs">{item.description}</div>
            <div
              className={cn(
                "mt-1 text-xs",
                item.state === "open" ? "text-amber-800" : "text-muted-foreground",
              )}
            >
              {item.state === "auto"
                ? "Automatic: "
                : item.state === "overridden"
                  ? "Overridden: "
                  : ""}
              {item.state === "overridden" ? item.overrideReason : item.detail}
              {item.doneAt ? ` (${formatDateTime(item.doneAt)})` : ""}
            </div>
          </div>
          {canEdit && item.state !== "auto" ? (
            <div className="flex shrink-0 gap-1">
              {item.state === "open" ? (
                <>
                  <Button size="xs" variant="outline" onClick={() => change(item.key, true)}>
                    Mark done
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setOverriding(item)}>
                    Override…
                  </Button>
                </>
              ) : (
                <Button size="xs" variant="ghost" onClick={() => change(item.key, false)}>
                  Undo
                </Button>
              )}
            </div>
          ) : null}
        </div>
      ))}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {overriding ? (
        <OverrideItemDialog
          item={overriding}
          onClose={() => setOverriding(null)}
          onConfirm={(reason) => {
            change(overriding.key, false, reason);
            setOverriding(null);
          }}
        />
      ) : null}
    </div>
  );
}

function StateIcon({ state }: { state: ChecklistState }) {
  if (state === "auto")
    return (
      <Sparkles
        className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
        aria-label="Satisfied automatically"
      />
    );
  if (state === "done")
    return <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-label="Done" />;
  if (state === "overridden")
    return (
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-label="Overridden" />
    );
  return <Circle className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" aria-label="Open" />;
}

function OverrideItemDialog({
  item,
  onClose,
  onConfirm,
}: {
  item: ChecklistItemView;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override “{item.label}”</DialogTitle>
          <DialogDescription>
            The year can be closed without this item. Your reason is kept with the year and written
            to the Activity log.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="item-reason">Reason</Label>
          <Textarea
            id="item-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Why this item does not apply this year"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={reason.trim().length < 5}
            onClick={() => onConfirm(reason.trim())}
          >
            Override item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
