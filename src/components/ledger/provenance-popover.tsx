"use client";

import { BadgeCheck, Info } from "lucide-react";
import type { LedgerRow } from "@/lib/ledger/query";
import { CLASSIFICATION_LABELS, KIND_LABELS, SOURCE_LABELS } from "@/lib/ledger/types";
import { formatDateTime } from "@/lib/format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Where a transaction came from and who touched it: the "Filled in by" trail the users already rely on. */
export function ProvenancePopover({ row, className }: { row: LedgerRow; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded p-0.5",
            className,
          )}
          aria-label="Where this transaction came from"
          onClick={(e) => e.stopPropagation()}
        >
          {row.verifiedByOwner ? (
            <BadgeCheck className="h-4 w-4 text-emerald-600" aria-hidden />
          ) : (
            <Info className="h-4 w-4" aria-hidden />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 font-medium">Provenance</div>
        <ProvenanceList row={row} />
      </PopoverContent>
    </Popover>
  );
}

export function ProvenanceList({ row }: { row: LedgerRow }) {
  return (
    <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1 text-xs">
      <dt className="text-muted-foreground">Kind</dt>
      <dd>{KIND_LABELS[row.kind]}</dd>
      <dt className="text-muted-foreground">Source</dt>
      <dd>{SOURCE_LABELS[row.source]}</dd>
      <dt className="text-muted-foreground">Classified</dt>
      <dd>{row.classificationSource ? CLASSIFICATION_LABELS[row.classificationSource] : "—"}</dd>
      <dt className="text-muted-foreground">Verified by Jose</dt>
      <dd>
        {row.verifiedByOwner ? <span className="text-emerald-700">Yes (from Jose)</span> : "No"}
      </dd>
      <dt className="text-muted-foreground">Filled in by</dt>
      <dd>{row.filledInBy ?? "—"}</dd>
      {row.sourceFile ? (
        <>
          <dt className="text-muted-foreground">Source file</dt>
          <dd className="break-all">
            {row.sourceFile}
            {row.sourceRef ? ` · row ${row.sourceRef}` : ""}
            {row.sourceRef2 ? ` · id ${row.sourceRef2}` : ""}
          </dd>
        </>
      ) : null}
      <dt className="text-muted-foreground">Entered</dt>
      <dd>
        {formatDateTime(row.createdAt)}
        {row.createdBy ? ` by ${row.createdBy}` : ""}
      </dd>
      {row.postedAt ? (
        <>
          <dt className="text-muted-foreground">Posted</dt>
          <dd>
            {formatDateTime(row.postedAt)}
            {row.postedBy ? ` by ${row.postedBy}` : ""}
          </dd>
        </>
      ) : null}
      {row.voidedAt ? (
        <>
          <dt className="text-muted-foreground">Voided</dt>
          <dd>
            {formatDateTime(row.voidedAt)}
            {row.voidedBy ? ` by ${row.voidedBy}` : ""}
            {row.voidReason ? ` — ${row.voidReason}` : ""}
          </dd>
        </>
      ) : null}
      {row.needsModelSplit ? (
        <>
          <dt className="text-muted-foreground">Model split</dt>
          <dd className="text-amber-800">Needs the allocation model (Phase 5)</dd>
        </>
      ) : null}
      {row.flags.length > 0 ? (
        <>
          <dt className="text-muted-foreground">Flags</dt>
          <dd>
            {row.flags
              .map((f) =>
                typeof f === "object" && f && "reason" in f
                  ? String((f as { reason: unknown }).reason)
                  : JSON.stringify(f),
              )
              .join("; ")}
          </dd>
        </>
      ) : null}
    </dl>
  );
}
