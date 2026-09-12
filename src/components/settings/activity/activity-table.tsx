"use client";

import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** A serialisable row: dates and ids already turned into strings on the server. */
export interface ActivityTableRow {
  id: string;
  atLabel: string;
  atIso: string;
  user: string;
  userEmail: string | null;
  action: string;
  subjectType: string | null;
  subjectId: string | null;
  subjectLabel: string | null;
  entityCode: string | null;
  reason: string | null;
  ip: string | null;
  isLockOverride: boolean;
  sessionId: string | null;
  userAgent: string | null;
  beforeJson: string | null;
  afterJson: string | null;
}

export function ActivityTable({ rows }: { rows: ActivityTableRow[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="bg-card rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead className="whitespace-nowrap">When</TableHead>
            <TableHead>User</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>IP</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const expanded = open.has(r.id);
            return (
              <Fragment key={r.id}>
                <TableRow
                  className={cn("cursor-pointer", expanded && "bg-muted/40")}
                  onClick={() => toggle(r.id)}
                  aria-expanded={expanded}
                >
                  <TableCell className="py-1.5 pr-0">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground rounded p-0.5"
                      aria-label={expanded ? "Hide details" : "Show details"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(r.id);
                      }}
                    >
                      <ChevronRight
                        className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")}
                        aria-hidden
                      />
                    </button>
                  </TableCell>
                  <TableCell className="tabular text-muted-foreground py-1.5 whitespace-nowrap">
                    <time dateTime={r.atIso}>{r.atLabel}</time>
                  </TableCell>
                  <TableCell className="py-1.5">
                    <span
                      className={cn(r.user === "system" && "text-muted-foreground italic")}
                      title={r.userEmail ?? undefined}
                    >
                      {r.user}
                    </span>
                  </TableCell>
                  <TableCell className="py-1.5 font-mono text-xs">
                    {r.action}
                    {r.isLockOverride ? (
                      <span className="ml-2 inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-600/20 ring-inset">
                        override
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell
                    className="max-w-[260px] truncate py-1.5"
                    title={r.subjectLabel ?? undefined}
                  >
                    {r.subjectLabel ?? <span className="text-muted-foreground">—</span>}
                    {r.subjectType ? (
                      <span className="text-muted-foreground ml-1 text-xs">({r.subjectType})</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular py-1.5">
                    {r.entityCode ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground max-w-[260px] truncate py-1.5"
                    title={r.reason ?? undefined}
                  >
                    {r.reason ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground py-1.5 font-mono text-xs">
                    {r.ip ?? "—"}
                  </TableCell>
                </TableRow>
                {expanded ? (
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableCell colSpan={8} className="p-0">
                      <RowDetails row={r} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function RowDetails({ row }: { row: ActivityTableRow }) {
  return (
    <div className="space-y-3 px-4 py-3 text-sm">
      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <Meta label="Log entry">#{row.id}</Meta>
        <Meta label="Subject id">{row.subjectId ?? "—"}</Meta>
        <Meta label="Session">{row.sessionId ?? "—"}</Meta>
        <Meta label="Signed in as">
          {row.userEmail ?? (row.user === "system" ? "system (no user)" : "—")}
        </Meta>
        <Meta label="Browser" className="sm:col-span-2 lg:col-span-4">
          {row.userAgent ?? "—"}
        </Meta>
      </dl>
      <div className="grid gap-3 md:grid-cols-2">
        <JsonPane title="Before" json={row.beforeJson} />
        <JsonPane title="After" json={row.afterJson} />
      </div>
    </div>
  );
}

function Meta({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono break-all">{children}</dd>
    </div>
  );
}

function JsonPane({ title, json }: { title: string; json: string | null }) {
  return (
    <div className="bg-background min-w-0 rounded-md border">
      <div className="text-muted-foreground border-b px-3 py-1.5 text-xs font-medium">{title}</div>
      {json === null ? (
        <div className="text-muted-foreground px-3 py-2 text-xs">Nothing recorded.</div>
      ) : (
        <pre className="max-h-80 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre">
          {json}
        </pre>
      )}
    </div>
  );
}
