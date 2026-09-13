"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, History, Paperclip, Scissors } from "lucide-react";
import type { LedgerLineView, LedgerRow, PickerData, TransactionDetail } from "@/lib/ledger/query";
import type { LedgerResult } from "@/server/actions/ledger";
import {
  getTransactionDetailAction,
  setLineAccountClassAction,
  setUserNoteAction,
} from "@/server/actions/ledger";
import { formatCents } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/components/status-chip";
import { ProvenanceList } from "./provenance-popover";
import { AccountSelect, ClassSelect, SELECT_CLASS } from "./pickers";

export interface SheetActions {
  edit: (row: LedgerRow) => void;
  split: (row: LedgerRow, line: LedgerLineView) => void;
  unsplit: (row: LedgerRow) => void;
  void: (row: LedgerRow) => void;
  post: (row: LedgerRow) => void;
  receipts: (row: LedgerRow) => void;
}

/**
 * The details drawer: journal lines (with inline account/class edit and split per line), provenance,
 * notes, receipts placeholder and the transaction's own audit history.
 */
export function TransactionSheet({
  row,
  open,
  onOpenChange,
  picker,
  canWrite,
  canNote,
  call,
  actions,
  refreshKey,
}: {
  row: LedgerRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  picker: PickerData;
  canWrite: boolean;
  canNote: boolean;
  /** The locked-year flow wrapper from the grid. */
  call: (fn: (lockOverrideReason?: string) => Promise<LedgerResult>) => Promise<LedgerResult>;
  actions: SheetActions;
  /** Bumped by the grid after every change so the drawer reloads. */
  refreshKey: number;
}) {
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [showReplaced, setShowReplaced] = useState(false);
  const [tab, setTab] = useState<"lines" | "notes" | "history">("lines");

  useEffect(() => {
    let cancelled = false;
    if (!open || !row) {
      setDetail(null);
      return;
    }
    getTransactionDetailAction(row.id).then((d) => {
      if (!cancelled) setDetail(d);
    });
    return () => {
      cancelled = true;
    };
  }, [open, row, refreshKey]);

  const current = detail?.row ?? row;
  if (!current) return null;
  const editable = canWrite && current.status !== "VOIDED";
  const lines = showReplaced ? (detail?.allLines ?? current.lines) : current.lines;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-3xl"
      >
        <SheetHeader className="border-b">
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="text-lg">
              #{current.seq} {current.vendor ?? "(no vendor)"}
            </SheetTitle>
            <StatusChip status={current.status} />
            {current.isCrossEntity ? (
              <span className="bg-muted rounded px-1.5 py-0.5 text-xs">
                {current.entityCodes.join(" ↔ ")}
              </span>
            ) : null}
          </div>
          <SheetDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="tabular">{formatDate(current.date)}</span>
            <span className="tabular font-medium">
              {formatCents(BigInt(current.amountCents ?? current.totalCents), { symbol: true })}
            </span>
            <span>
              {current.bankLabel ??
                (current.kind === "ADJUSTING" ? "Adjusting entry" : "Journal entry")}
            </span>
            {current.memo ? <span className="text-muted-foreground">· {current.memo}</span> : null}
          </SheetDescription>
          <div className="mt-2 flex flex-wrap gap-2">
            {editable ? (
              <Button size="xs" variant="outline" onClick={() => actions.edit(current)}>
                Edit
              </Button>
            ) : null}
            {editable && current.kind === "BANK" && !current.isSplit && current.primaryLineId ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  actions.split(
                    current,
                    current.lines.find((l) => l.id === current.primaryLineId) as LedgerLineView,
                  )
                }
              >
                <Scissors /> Split
              </Button>
            ) : null}
            {editable && current.splitRootLineId ? (
              <Button size="xs" variant="outline" onClick={() => actions.unsplit(current)}>
                <GitBranch /> Unsplit
              </Button>
            ) : null}
            {editable && (current.status === "DRAFT" || current.status === "FLAGGED") ? (
              <Button size="xs" onClick={() => actions.post(current)}>
                Post
              </Button>
            ) : null}
            {editable ? (
              <Button
                size="xs"
                variant="ghost"
                className="text-destructive"
                onClick={() => actions.void(current)}
              >
                Void…
              </Button>
            ) : null}
            <Button size="xs" variant="ghost" onClick={() => actions.receipts(current)}>
              <Paperclip /> Receipts ({current.receiptCount})
            </Button>
          </div>
        </SheetHeader>

        <div className="flex gap-1 border-b px-4 pt-2">
          {(
            [
              ["lines", "Journal lines"],
              ["notes", "Notes"],
              ["history", "History"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "text-muted-foreground hover:text-foreground -mb-px border-b-2 px-3 py-2 text-sm",
                tab === key ? "border-primary text-foreground font-medium" : "border-transparent",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 px-4 py-4">
          {tab === "lines" ? (
            <div className="space-y-3">
              <div className="text-muted-foreground flex items-center justify-between text-xs">
                <span>
                  Debits equal credits for each business. Bank and bridge lines are derived from the
                  account/class lines.
                </span>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="accent-primary size-3.5"
                    checked={showReplaced}
                    onChange={(e) => setShowReplaced(e.target.checked)}
                  />
                  Show replaced lines
                </label>
              </div>
              <LinesTable
                lines={lines}
                allLines={detail?.allLines ?? current.lines}
                row={current}
                picker={picker}
                editable={editable}
                call={call}
                onSplit={(line) => actions.split(current, line)}
              />
              <div className="border-t pt-3">
                <div className="mb-1 text-xs font-medium">Provenance</div>
                <ProvenanceList row={current} />
              </div>
            </div>
          ) : null}
          {tab === "notes" ? <NotesPanel row={current} canNote={canNote} /> : null}
          {tab === "history" ? <HistoryPanel detail={detail} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LinesTable({
  lines,
  allLines,
  row,
  picker,
  editable,
  call,
  onSplit,
}: {
  lines: LedgerLineView[];
  /** Every line ever, so a split child can name the (replaced) line it came from. */
  allLines: LedgerLineView[];
  row: LedgerRow;
  picker: PickerData;
  editable: boolean;
  call: (fn: (lockOverrideReason?: string) => Promise<LedgerResult>) => Promise<LedgerResult>;
  onSplit: (line: LedgerLineView) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const change = (line: LedgerLineView, patch: { accountId?: string; classId?: string }) =>
    start(async () => {
      setError(null);
      const result = await call((lockOverrideReason) =>
        setLineAccountClassAction({ lineId: line.id, ...patch, lockOverrideReason }),
      );
      if (result.error) setError(result.error);
      else router.refresh();
    });
  const lineNoOf = (id: string | null) => allLines.find((l) => l.id === id)?.lineNo;
  return (
    <div className={cn("overflow-x-auto rounded-md border", pending && "opacity-60")}>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground text-xs">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">#</th>
            <th className="px-2 py-1.5 text-left font-medium">Account</th>
            <th className="px-2 py-1.5 text-left font-medium">Class</th>
            <th className="px-2 py-1.5 text-left font-medium">Entity</th>
            <th className="px-2 py-1.5 text-right font-medium">Debit</th>
            <th className="px-2 py-1.5 text-right font-medium">Credit</th>
            <th className="px-2 py-1.5 text-left font-medium">Memo</th>
            <th className="w-16" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const replaced = !!l.supersededAt;
            const canEdit = editable && !replaced && !l.isDerived;
            return (
              <tr
                key={l.id}
                className={cn(
                  "border-t",
                  replaced && "text-muted-foreground line-through",
                  l.isBridge && !replaced && "bg-amber-50/40",
                  l.isBank && !replaced && "bg-muted/30",
                )}
              >
                <td className="tabular px-2 py-1">{l.lineNo}</td>
                <td className="px-2 py-1">
                  {canEdit ? (
                    <AccountSelect
                      accounts={picker.accounts}
                      value={l.accountId ?? ""}
                      onChange={(v) => v && v !== l.accountId && change(l, { accountId: v })}
                      className={cn(SELECT_CLASS, "h-7 text-xs")}
                    />
                  ) : (
                    <span>
                      {l.accountLabel}
                      {l.isBank ? (
                        <span className="text-muted-foreground ml-1 text-xs">(bank)</span>
                      ) : null}
                      {l.isBridge ? (
                        <span className="ml-1 text-xs text-amber-800">(bridge)</span>
                      ) : null}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1">
                  {canEdit ? (
                    <ClassSelect
                      classes={picker.classes}
                      value={l.classId ?? ""}
                      onChange={(v) => v && v !== l.classId && change(l, { classId: v })}
                      className={cn(SELECT_CLASS, "h-7 text-xs")}
                    />
                  ) : (
                    l.classLabel
                  )}
                </td>
                <td className="px-2 py-1 text-xs">{l.entityCode ?? "—"}</td>
                <td className="tabular px-2 py-1 text-right">
                  {l.debitCents ? formatCents(BigInt(l.debitCents)) : ""}
                </td>
                <td className="tabular px-2 py-1 text-right">
                  {l.creditCents ? formatCents(BigInt(l.creditCents)) : ""}
                </td>
                <td
                  className="text-muted-foreground max-w-[14rem] truncate px-2 py-1 text-xs"
                  title={l.memo ?? undefined}
                >
                  {l.memo ?? ""}
                  {l.parentLineId && !l.isBridge ? (
                    <span className="ml-1">(from line {lineNoOf(l.parentLineId) ?? "?"})</span>
                  ) : null}
                  {replaced ? (
                    <span className="ml-1">replaced {formatDateTime(l.supersededAt)}</span>
                  ) : null}
                </td>
                <td className="px-1 py-1 text-right">
                  {canEdit && row.status !== "VOIDED" ? (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Split line ${l.lineNo}`}
                      title="Split this line"
                      onClick={() => onSplit(l)}
                    >
                      <Scissors />
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error ? <p className="text-destructive border-t px-2 py-1.5 text-xs">{error}</p> : null}
    </div>
  );
}

function NotesPanel({ row, canNote }: { row: LedgerRow; canNote: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState(row.userNote ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setBody(row.userNote ?? "");
  }, [row.id, row.userNote]);
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1 text-xs font-medium">Your notes</div>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          disabled={!canNote}
          placeholder="Free text: what Jose said, what to check, anything worth remembering."
        />
        <div className="mt-2 flex items-center gap-2">
          {canNote ? (
            <Button
              size="xs"
              disabled={pending || body === (row.userNote ?? "")}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await setUserNoteAction({ id: row.id, body });
                  if (r.error) setError(r.error);
                  else {
                    setSaved("Saved.");
                    router.refresh();
                  }
                })
              }
            >
              {pending ? "Saving…" : "Save note"}
            </Button>
          ) : null}
          {saved ? <span className="text-muted-foreground text-xs">{saved}</span> : null}
          {error ? <span className="text-destructive text-xs">{error}</span> : null}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium">System notes</div>
        <p className="text-muted-foreground mb-2 text-xs">
          Written by the app (AI reasoning, matches, splits, model applications). Append-only.
        </p>
        {row.systemNotes.length === 0 ? (
          <p className="text-muted-foreground text-sm">None yet.</p>
        ) : (
          <ol className="space-y-2">
            {row.systemNotes.map((n) => (
              <li key={n.id} className="bg-muted/30 rounded-md border px-3 py-2 text-sm">
                <div className="text-muted-foreground tabular text-xs">
                  {formatDateTime(n.at)}
                  {n.by ? ` · ${n.by}` : ""}
                </div>
                <div className="whitespace-pre-wrap">{n.body}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function HistoryPanel({ detail }: { detail: TransactionDetail | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!detail) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (detail.audit.length === 0)
    return <p className="text-muted-foreground text-sm">No history recorded.</p>;
  return (
    <ol className="space-y-2">
      {detail.audit.map((a) => (
        <li key={a.id} className="rounded-md border px-3 py-2 text-sm">
          <button
            type="button"
            className="flex w-full items-start gap-2 text-left"
            onClick={() => setOpenId(openId === a.id ? null : a.id)}
          >
            <History className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-mono text-xs">{a.action}</span>
              {a.isLockOverride ? (
                <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-600/20 ring-inset">
                  override
                </span>
              ) : null}
              <span className="text-muted-foreground tabular block text-xs">
                {formatDateTime(a.at)}
                {a.user ? ` · ${a.user}` : ""}
                {a.reason ? ` · ${a.reason}` : ""}
              </span>
            </span>
          </button>
          {openId === a.id ? (
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <Json title="Before" value={a.before} />
              <Json title="After" value={a.after} />
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function Json({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="bg-background min-w-0 rounded-md border">
      <div className="text-muted-foreground border-b px-2 py-1 text-xs font-medium">{title}</div>
      <pre className="max-h-64 overflow-auto px-2 py-1 font-mono text-[11px] leading-relaxed whitespace-pre">
        {value === null || value === undefined ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
