"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type Row,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  StickyNote,
  X,
} from "lucide-react";
import type { LedgerLineView, LedgerRow, PickerData } from "@/lib/ledger/query";
import type { SavedViewRow } from "@/lib/ledger/saved-views";
import type { LedgerResult } from "@/server/actions/ledger";
import {
  deleteViewAction,
  saveViewAction,
  setLineAccountClassAction,
} from "@/server/actions/ledger";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { StatusChip } from "@/components/status-chip";
import { EmptyState } from "@/components/shell/empty-state";
import { BookOpen } from "lucide-react";
import { AccountSelect, ClassSelect, SELECT_CLASS } from "./pickers";
import { useLockedYearFlow } from "./lock-override-dialog";
import { TransactionDialog } from "./transaction-dialog";
import { JournalDialog } from "./journal-dialog";
import { SplitDialog, UnsplitDialog } from "./split-dialog";
import { PostDialog, VoidDialog } from "./void-dialog";
import { ReceiptViewerDialog } from "./receipt-viewer";
import { ProvenancePopover } from "./provenance-popover";
import { TransactionSheet } from "./transaction-sheet";

export interface GridScope {
  entityId: string;
  entityCode: string;
  year: number;
  yearState: "OPEN" | "CLOSED" | "FILED";
  overrideCount: number;
}

export interface GridPermissions {
  /** Create drafts, confirm, edit drafts, write notes. */
  write: boolean;
  /** Edit, split, void posted rows. */
  editPosted: boolean;
}

interface ViewState {
  search: string;
  statuses: string[];
  accountId: string;
  classId: string;
  bankId: string;
  kind: string;
  sorting: SortingState;
  journalView: boolean;
  pageSize: number;
}

const DEFAULT_VIEW: ViewState = {
  search: "",
  statuses: ["POSTED", "DRAFT", "FLAGGED"],
  accountId: "",
  classId: "",
  bankId: "",
  kind: "",
  sorting: [{ id: "date", desc: true }],
  journalView: false,
  pageSize: 100,
};

type DialogState =
  | { kind: "new" }
  | { kind: "newJournal" }
  | { kind: "edit"; row: LedgerRow }
  | { kind: "split"; row: LedgerRow; line: LedgerLineView }
  | { kind: "unsplit"; row: LedgerRow }
  | { kind: "void"; row: LedgerRow }
  | { kind: "post"; row: LedgerRow }
  | { kind: "receipts"; row: LedgerRow }
  | { kind: "saveView" }
  | null;

interface GridMeta {
  picker: PickerData;
  canEditRow: (row: LedgerRow) => boolean;
  call: (fn: (lockOverrideReason?: string) => Promise<LedgerResult>) => Promise<LedgerResult>;
  openDialog: (d: DialogState) => void;
  openSheet: (row: LedgerRow) => void;
  afterChange: () => void;
}

function money(cents: number, opts: { symbol?: boolean } = {}) {
  return formatCents(BigInt(cents), opts);
}

export function LedgerGrid({
  rows,
  picker,
  scope,
  views: initialViews,
  can,
}: {
  rows: LedgerRow[];
  picker: PickerData;
  scope: GridScope;
  views: SavedViewRow[];
  can: GridPermissions;
}) {
  const router = useRouter();
  const { call, overrideDialog } = useLockedYearFlow();
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
  const [views, setViews] = useState<SavedViewRow[]>(initialViews);
  const [activeView, setActiveView] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_VIEW.pageSize,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRefreshKey((k) => k + 1);
  }, [rows]);

  const patch = (p: Partial<ViewState>) => {
    setView((v) => ({ ...v, ...p }));
    setActiveView(null);
    setPagination((pg) => ({ ...pg, pageIndex: 0 }));
  };

  const canEditRow = useCallback(
    (row: LedgerRow) => {
      if (row.status === "VOIDED") return false;
      return row.status === "POSTED" ? can.editPosted : can.write;
    },
    [can],
  );

  const data = useMemo(() => rows, [rows]);
  const columnFilters = useMemo<ColumnFiltersState>(() => {
    const f: ColumnFiltersState = [{ id: "status", value: view.statuses }];
    if (view.accountId) f.push({ id: "account", value: view.accountId });
    if (view.classId) f.push({ id: "class", value: view.classId });
    if (view.bankId) f.push({ id: "bank", value: view.bankId });
    if (view.kind) f.push({ id: "kind", value: view.kind });
    return f;
  }, [view.statuses, view.accountId, view.classId, view.bankId, view.kind]);

  const columns = useMemo<ColumnDef<LedgerRow>[]>(
    () => [
      {
        id: "date",
        accessorKey: "date",
        header: "Date",
        cell: ({ getValue }) => (
          <span className="tabular whitespace-nowrap">{formatDate(getValue<string>())}</span>
        ),
        enableGlobalFilter: false,
      },
      {
        id: "seq",
        accessorKey: "seq",
        header: "#",
        cell: ({ getValue }) => (
          <span className="tabular text-muted-foreground">{getValue<number>()}</span>
        ),
        enableGlobalFilter: false,
      },
      {
        id: "vendor",
        accessorFn: (r) => r.vendor ?? "",
        header: "Vendor",
        cell: ({ row }) => (
          <span
            className="block max-w-[16rem] truncate font-medium"
            title={row.original.vendor ?? undefined}
          >
            {row.original.vendor ?? <span className="text-muted-foreground">—</span>}
          </span>
        ),
        enableGlobalFilter: true,
      },
      {
        id: "memo",
        accessorFn: (r) => r.memo ?? "",
        header: "Memo",
        cell: ({ row }) => (
          <span
            className="text-muted-foreground block max-w-[14rem] truncate"
            title={row.original.memo ?? undefined}
          >
            {row.original.memo ?? ""}
          </span>
        ),
        enableGlobalFilter: false,
      },
      {
        id: "account",
        accessorFn: (r) => r.accountLabel,
        header: "Account",
        cell: (ctx) => (
          <InlineAccountCell row={ctx.row.original} meta={ctx.table.options.meta as GridMeta} />
        ),
        filterFn: (row, _id, value: string) =>
          !value || row.original.lines.some((l) => !l.isBridge && l.accountId === value),
        enableGlobalFilter: false,
      },
      {
        id: "class",
        accessorFn: (r) => r.classLabel,
        header: "Class",
        cell: (ctx) => (
          <InlineClassCell row={ctx.row.original} meta={ctx.table.options.meta as GridMeta} />
        ),
        filterFn: (row, _id, value: string) =>
          !value || row.original.lines.some((l) => !l.isBridge && l.classId === value),
        enableGlobalFilter: false,
      },
      {
        id: "bank",
        accessorFn: (r) => r.bankLabel ?? "",
        header: "Bank",
        cell: ({ row }) => (
          <span className="text-muted-foreground whitespace-nowrap">
            {row.original.bankLabel ??
              (row.original.kind === "ADJUSTING" ? "adjusting" : "journal")}
          </span>
        ),
        filterFn: (row, _id, value: string) => !value || row.original.bankAccountId === value,
        enableGlobalFilter: false,
      },
      {
        id: "amount",
        accessorFn: (r) => r.amountCents ?? r.totalCents,
        header: () => <span className="block text-right">Amount</span>,
        cell: ({ row }) => {
          const r = row.original;
          const v = r.amountCents;
          return (
            <span
              className={cn(
                "tabular block text-right whitespace-nowrap",
                v !== null && v < 0 && "text-money-negative",
                r.status === "VOIDED" && "text-muted-foreground line-through",
              )}
            >
              {v === null ? (
                <span className="text-muted-foreground">{money(r.totalCents)}</span>
              ) : (
                money(v)
              )}
            </span>
          );
        },
        enableGlobalFilter: false,
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <span className="flex items-center gap-1">
            <StatusChip status={row.original.status} />
            {row.original.isCrossEntity ? (
              <span
                className="bg-muted text-muted-foreground rounded px-1 py-0.5 text-[10px] font-medium"
                title="This transaction touches both businesses"
              >
                {row.original.entityCodes.join("↔")}
              </span>
            ) : null}
          </span>
        ),
        filterFn: (row, _id, value: string[]) => value.includes(row.original.status),
        enableGlobalFilter: false,
      },
      {
        id: "kind",
        accessorKey: "kind",
        header: "Type",
        cell: ({ getValue }) => {
          const k = getValue<string>();
          return (
            <span className="text-muted-foreground text-xs">
              {k === "BANK" ? "Bank" : k === "JOURNAL" ? "Journal" : "Adjusting"}
            </span>
          );
        },
        filterFn: (row, _id, value: string) => !value || row.original.kind === value,
        enableGlobalFilter: false,
      },
      {
        id: "info",
        header: "",
        cell: (ctx) => (
          <InfoCell row={ctx.row.original} meta={ctx.table.options.meta as GridMeta} />
        ),
        enableSorting: false,
        enableGlobalFilter: false,
      },
      {
        id: "actions",
        header: "",
        cell: (ctx) => <RowMenu row={ctx.row.original} meta={ctx.table.options.meta as GridMeta} />,
        enableSorting: false,
        enableGlobalFilter: false,
      },
    ],
    [],
  );

  const meta = useMemo<GridMeta>(
    () => ({
      picker,
      canEditRow,
      call,
      openDialog: setDialog,
      openSheet: (row) => setSheetId(row.id),
      afterChange: () => router.refresh(),
    }),
    [picker, canEditRow, call, router],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting: view.sorting, columnFilters, globalFilter: view.search, pagination },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(view.sorting) : updater;
      setView((v) => ({ ...v, sorting: next }));
    },
    onPaginationChange: setPagination,
    globalFilterFn: (row, _columnId, filterValue) =>
      row.original.searchText.includes(String(filterValue).trim().toLowerCase()),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (r) => r.id,
    meta,
  });

  const pageRows = table.getRowModel().rows;
  const filteredRows = table.getFilteredRowModel().rows;
  const totals = useMemo(() => {
    let inn = 0;
    let out = 0;
    let journals = 0;
    for (const r of filteredRows) {
      const v = r.original.amountCents;
      if (r.original.status === "VOIDED") continue;
      if (v === null) journals += 1;
      else if (v > 0) inn += v;
      else out += v;
    }
    return { count: filteredRows.length, inn, out, net: inn + out, journals };
  }, [filteredRows]);

  const sheetRow = sheetId ? (rows.find((r) => r.id === sheetId) ?? null) : null;
  const selectedRow = selectedId ? (rows.find((r) => r.id === selectedId) ?? null) : null;

  // Keyboard: j/k move, Enter open, e edit, s split/unsplit, v void, p post, n new, / search, Esc clear.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        if (e.key === "Escape") (target as HTMLInputElement).blur();
        return;
      }
      if (document.querySelector("[role=dialog][data-state=open]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const ids = pageRows.map((r) => r.id);
      const idx = selectedId ? ids.indexOf(selectedId) : -1;
      const move = (delta: number) => {
        if (ids.length === 0) return;
        const next = Math.min(ids.length - 1, Math.max(0, idx + delta));
        setSelectedId(ids[next] ?? null);
        document.getElementById(`ledger-row-${ids[next]}`)?.scrollIntoView({ block: "nearest" });
      };
      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          move(idx < 0 ? 0 : 1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          move(-1);
          break;
        case "Enter":
          if (selectedRow) setSheetId(selectedRow.id);
          break;
        case "e":
          if (selectedRow && canEditRow(selectedRow)) setDialog({ kind: "edit", row: selectedRow });
          break;
        case "s":
          if (selectedRow && canEditRow(selectedRow)) {
            if (selectedRow.splitRootLineId) setDialog({ kind: "unsplit", row: selectedRow });
            else if (selectedRow.primaryLineId) {
              const line = selectedRow.lines.find((l) => l.id === selectedRow.primaryLineId);
              if (line) setDialog({ kind: "split", row: selectedRow, line });
            } else setSheetId(selectedRow.id);
          }
          break;
        case "v":
          if (selectedRow && canEditRow(selectedRow)) setDialog({ kind: "void", row: selectedRow });
          break;
        case "p":
          if (
            selectedRow &&
            can.write &&
            (selectedRow.status === "DRAFT" || selectedRow.status === "FLAGGED")
          )
            setDialog({ kind: "post", row: selectedRow });
          break;
        case "n":
          if (can.write) setDialog({ kind: "new" });
          break;
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case "Escape":
          setSelectedId(null);
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pageRows, selectedId, selectedRow, canEditRow, can.write]);

  const applyView = (v: SavedViewRow) => {
    const s = (v.state ?? {}) as Partial<ViewState>;
    setView({ ...DEFAULT_VIEW, ...s });
    setPagination((pg) => ({ pageIndex: 0, pageSize: s.pageSize ?? pg.pageSize }));
    setActiveView(v.id);
  };

  const defaultBank = picker.bankAccounts.find((b) => b.entityId === scope.entityId)?.id ?? null;
  const sheetActions = {
    edit: (row: LedgerRow) => setDialog({ kind: "edit", row }),
    split: (row: LedgerRow, line: LedgerLineView) => setDialog({ kind: "split", row, line }),
    unsplit: (row: LedgerRow) => setDialog({ kind: "unsplit", row }),
    void: (row: LedgerRow) => setDialog({ kind: "void", row }),
    post: (row: LedgerRow) => setDialog({ kind: "post", row }),
    receipts: (row: LedgerRow) => setDialog({ kind: "receipts", row }),
  };

  return (
    <div className="space-y-3">
      {scope.yearState !== "OPEN" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <StatusChip status={scope.yearState} />
          <span>
            {scope.entityCode} {scope.year} is {scope.yearState.toLowerCase()}. Any change to a
            posted transaction asks for a reason and is recorded as an override.
          </span>
          {scope.overrideCount > 0 ? (
            <span className="ml-auto rounded-md bg-white px-2 py-0.5 text-xs font-medium ring-1 ring-amber-600/30">
              overridden {scope.overrideCount} {scope.overrideCount === 1 ? "time" : "times"}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="bg-card flex flex-wrap items-center gap-2 rounded-lg border p-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 h-4 w-4"
            aria-hidden
          />
          <Input
            ref={searchRef}
            value={view.search}
            onChange={(e) => patch({ search: e.target.value })}
            placeholder="Search vendor, memo, notes, account…  ( / )"
            className="pl-8"
            aria-label="Search"
          />
          {view.search ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground absolute top-2.5 right-2.5"
              aria-label="Clear search"
              onClick={() => patch({ search: "" })}
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Status">
          {(["POSTED", "DRAFT", "FLAGGED", "VOIDED"] as const).map((s) => {
            const on = view.statuses.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  patch({
                    statuses: on ? view.statuses.filter((x) => x !== s) : [...view.statuses, s],
                  })
                }
                className={cn(
                  "rounded-md border px-2 py-1 text-xs transition-colors",
                  on ? "bg-secondary border-transparent" : "text-muted-foreground border-dashed",
                )}
              >
                {s === "POSTED"
                  ? "Posted"
                  : s === "DRAFT"
                    ? "Drafts"
                    : s === "FLAGGED"
                      ? "Flagged"
                      : "Voided"}
              </button>
            );
          })}
        </div>
        <AccountSelect
          accounts={picker.accounts}
          value={view.accountId}
          onChange={(v) => patch({ accountId: v })}
          placeholder="Any account"
          className={cn(SELECT_CLASS, "w-52")}
        />
        <ClassSelect
          classes={picker.classes}
          value={view.classId}
          onChange={(v) => patch({ classId: v })}
          placeholder="Any class"
          className={cn(SELECT_CLASS, "w-48")}
        />
        <select
          value={view.bankId}
          onChange={(e) => patch({ bankId: e.target.value })}
          className={cn(SELECT_CLASS, "w-40")}
          aria-label="Bank account"
        >
          <option value="">Any bank</option>
          {picker.bankAccounts.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <select
          value={view.kind}
          onChange={(e) => patch({ kind: e.target.value })}
          className={cn(SELECT_CLASS, "w-32")}
          aria-label="Type"
        >
          <option value="">Any type</option>
          <option value="BANK">Bank</option>
          <option value="JOURNAL">Journal</option>
          <option value="ADJUSTING">Adjusting</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="accent-primary size-4"
            checked={view.journalView}
            onChange={(e) => patch({ journalView: e.target.checked })}
          />
          Journal view
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Bookmark />{" "}
              {activeView ? (views.find((v) => v.id === activeView)?.name ?? "Views") : "Views"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Saved views</DropdownMenuLabel>
            {views.length === 0 ? (
              <div className="text-muted-foreground px-2 py-1.5 text-xs">None saved yet.</div>
            ) : null}
            {views.map((v) => (
              <DropdownMenuItem
                key={v.id}
                onSelect={() => applyView(v)}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate">{v.name}</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive rounded p-0.5"
                  aria-label={`Delete view ${v.name}`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const r = await deleteViewAction(v.id);
                    if (r.views) setViews(r.views);
                    if (activeView === v.id) setActiveView(null);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setDialog({ kind: "saveView" })}>
              Save current view…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setView(DEFAULT_VIEW);
                setActiveView(null);
                setPagination({ pageIndex: 0, pageSize: DEFAULT_VIEW.pageSize });
              }}
            >
              Reset filters
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {can.write ? (
          <>
            <Button size="sm" onClick={() => setDialog({ kind: "new" })}>
              <Plus /> New transaction
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "newJournal" })}>
              Journal entry
            </Button>
          </>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={`No transactions for ${scope.entityCode} in ${scope.year} yet`}
          description={
            can.write
              ? "Press N or click “New transaction” to enter the first one. Imports from the workbooks arrive in Phase 2."
              : "Nothing has been entered for this year."
          }
        />
      ) : view.journalView ? (
        <JournalLinesTable
          rows={pageRows.map((r) => r.original)}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          onOpen={(row) => setSheetId(row.id)}
        />
      ) : (
        <div className="bg-card overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-card sticky top-0 z-[1] border-b">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const sortable = h.column.getCanSort();
                    const dir = h.column.getIsSorted();
                    return (
                      <th
                        key={h.id}
                        className="text-muted-foreground h-9 px-2 text-left align-middle text-xs font-medium whitespace-nowrap"
                      >
                        {h.isPlaceholder ? null : sortable ? (
                          <button
                            type="button"
                            className="hover:text-foreground inline-flex items-center gap-1"
                            onClick={h.column.getToggleSortingHandler()}
                          >
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            {dir === "asc" ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : dir === "desc" ? (
                              <ArrowDown className="h-3 w-3" />
                            ) : (
                              <ArrowUpDown className="h-3 w-3 opacity-40" />
                            )}
                          </button>
                        ) : (
                          flexRender(h.column.columnDef.header, h.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="text-muted-foreground py-10 text-center">
                    Nothing matches these filters.
                  </td>
                </tr>
              ) : (
                pageRows.map((r) => (
                  <GridRow
                    key={r.id}
                    row={r}
                    selected={selectedId === r.id}
                    onSelect={() => setSelectedId(r.id)}
                    onOpen={() => setSheetId(r.id)}
                  />
                ))
              )}
            </tbody>
            <tfoot className="bg-muted/40 border-t text-xs">
              <tr>
                <td colSpan={columns.length} className="px-2 py-2">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                    <span>
                      <span className="tabular font-medium">{totals.count.toLocaleString()}</span>{" "}
                      {totals.count === 1 ? "transaction" : "transactions"}
                      {totals.count !== rows.length ? (
                        <span className="text-muted-foreground">
                          {" "}
                          of {rows.length.toLocaleString()}
                        </span>
                      ) : null}
                    </span>
                    <span>
                      Money in <span className="tabular font-medium">{money(totals.inn)}</span>
                    </span>
                    <span>
                      Money out{" "}
                      <span className="tabular text-money-negative font-medium">
                        {money(totals.out)}
                      </span>
                    </span>
                    <span>
                      Net{" "}
                      <span
                        className={cn(
                          "tabular font-medium",
                          totals.net < 0 && "text-money-negative",
                        )}
                      >
                        {money(totals.net)}
                      </span>
                    </span>
                    {totals.journals > 0 ? (
                      <span className="text-muted-foreground">
                        {totals.journals} journal entr{totals.journals === 1 ? "y" : "ies"} not in
                        the cash totals
                      </span>
                    ) : null}
                    <span className="text-muted-foreground ml-auto hidden md:inline">
                      j/k move · Enter open · e edit · s split · v void · p post · n new · / search
                    </span>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="text-muted-foreground flex items-center gap-2">
            <span>Rows per page</span>
            <select
              value={pagination.pageSize}
              onChange={(e) => {
                const size = Number(e.target.value);
                setPagination({ pageIndex: 0, pageSize: size });
                setView((v) => ({ ...v, pageSize: size }));
              }}
              className={cn(SELECT_CLASS, "h-8 w-24")}
              aria-label="Rows per page"
            >
              {[50, 100, 250, 1000].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              <ChevronLeft /> Previous
            </Button>
            <span className="text-muted-foreground tabular">
              Page {table.getState().pagination.pageIndex + 1} of{" "}
              {Math.max(1, table.getPageCount())}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}

      <TransactionSheet
        row={sheetRow}
        open={!!sheetRow}
        onOpenChange={(o) => !o && setSheetId(null)}
        picker={picker}
        canWrite={sheetRow ? canEditRow(sheetRow) : false}
        canNote={can.write}
        call={call}
        actions={sheetActions}
        refreshKey={refreshKey}
      />

      {dialog?.kind === "new" ? (
        <TransactionDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          picker={picker}
          defaultBankAccountId={defaultBank}
          defaultYear={scope.year}
        />
      ) : null}
      {dialog?.kind === "edit" && dialog.row.kind === "BANK" ? (
        <TransactionDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          picker={picker}
          defaultBankAccountId={defaultBank}
          defaultYear={scope.year}
          row={dialog.row}
        />
      ) : null}
      {dialog?.kind === "newJournal" ? (
        <JournalDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          picker={picker}
          defaultEntityId={scope.entityId}
          defaultYear={scope.year}
        />
      ) : null}
      {dialog?.kind === "edit" && dialog.row.kind !== "BANK" ? (
        <JournalDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          picker={picker}
          defaultEntityId={scope.entityId}
          defaultYear={scope.year}
          row={dialog.row}
        />
      ) : null}
      {dialog?.kind === "split" ? (
        <SplitDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          picker={picker}
          row={dialog.row}
          line={dialog.line}
        />
      ) : null}
      {dialog?.kind === "unsplit" && dialog.row.splitRootLineId ? (
        <UnsplitDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          picker={picker}
          row={dialog.row}
          parentLineId={dialog.row.splitRootLineId}
        />
      ) : null}
      {dialog?.kind === "void" ? (
        <VoidDialog open onOpenChange={(o) => !o && setDialog(null)} row={dialog.row} />
      ) : null}
      {dialog?.kind === "post" ? (
        <PostDialog open onOpenChange={(o) => !o && setDialog(null)} row={dialog.row} />
      ) : null}
      {dialog?.kind === "receipts" ? (
        <ReceiptViewerDialog open onOpenChange={(o) => !o && setDialog(null)} row={dialog.row} />
      ) : null}
      {dialog?.kind === "saveView" ? (
        <SaveViewDialog
          onClose={() => setDialog(null)}
          onSaved={(list, name) => {
            setViews(list);
            setActiveView(list.find((v) => v.name === name)?.id ?? null);
          }}
          state={{ ...view, pageSize: pagination.pageSize }}
        />
      ) : null}
      {overrideDialog}
    </div>
  );
}

function GridRow({
  row,
  selected,
  onSelect,
  onOpen,
}: {
  row: Row<LedgerRow>;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  return (
    <tr
      id={`ledger-row-${row.id}`}
      className={cn(
        "hover:bg-muted/40 cursor-pointer border-b transition-colors",
        selected && "bg-accent/60 ring-primary/30 ring-1 ring-inset",
        row.original.status === "VOIDED" && "text-muted-foreground",
      )}
      onClick={onSelect}
      onDoubleClick={onOpen}
      aria-selected={selected}
    >
      {row.getVisibleCells().map((cell) => (
        <td key={cell.id} className="px-2 py-1 align-middle">
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}

function useInlineEdit(row: LedgerRow, meta: GridMeta) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const editable = meta.canEditRow(row) && !!row.primaryLineId;
  const commit = (patch: { accountId?: string; classId?: string }) =>
    start(async () => {
      setError(null);
      const result = await meta.call((lockOverrideReason) =>
        setLineAccountClassAction({
          lineId: row.primaryLineId as string,
          ...patch,
          lockOverrideReason,
        }),
      );
      if (result.error) setError(result.error);
      else meta.afterChange();
      setEditing(false);
    });
  return { editing, setEditing, pending, error, editable, commit };
}

function InlineAccountCell({ row, meta }: { row: LedgerRow; meta: GridMeta }) {
  const { editing, setEditing, pending, error, editable, commit } = useInlineEdit(row, meta);
  if (editing) {
    return (
      <AccountSelect
        accounts={meta.picker.accounts}
        value={row.accountId ?? ""}
        onChange={(v) => (v && v !== row.accountId ? commit({ accountId: v }) : setEditing(false))}
        className={cn(SELECT_CLASS, "h-7 w-56 text-xs")}
        autoFocus
        disabled={pending}
      />
    );
  }
  return (
    <button
      type="button"
      className={cn(
        "block max-w-[15rem] truncate text-left",
        editable && "hover:bg-accent -mx-1 rounded px-1",
        !editable && "cursor-default",
      )}
      title={error ?? (editable ? "Click to change the account" : row.accountLabel)}
      onClick={(e) => {
        e.stopPropagation();
        if (editable) setEditing(true);
      }}
    >
      {error ? <span className="text-destructive">{error}</span> : row.accountLabel}
    </button>
  );
}

function InlineClassCell({ row, meta }: { row: LedgerRow; meta: GridMeta }) {
  const { editing, setEditing, pending, error, editable, commit } = useInlineEdit(row, meta);
  if (editing) {
    return (
      <ClassSelect
        classes={meta.picker.classes}
        value={row.classId ?? ""}
        onChange={(v) => (v && v !== row.classId ? commit({ classId: v }) : setEditing(false))}
        className={cn(SELECT_CLASS, "h-7 w-52 text-xs")}
        autoFocus
        disabled={pending}
      />
    );
  }
  return (
    <button
      type="button"
      className={cn(
        "block max-w-[14rem] truncate text-left",
        editable && "hover:bg-accent -mx-1 rounded px-1",
        !editable && "cursor-default",
      )}
      title={error ?? (editable ? "Click to change the class" : row.classLabel)}
      onClick={(e) => {
        e.stopPropagation();
        if (editable) setEditing(true);
      }}
    >
      {error ? <span className="text-destructive">{error}</span> : row.classLabel}
    </button>
  );
}

function InfoCell({ row, meta }: { row: LedgerRow; meta: GridMeta }) {
  return (
    <span className="flex items-center gap-0.5">
      <button
        type="button"
        className={cn(
          "rounded p-0.5",
          row.receiptCount > 0 || row.receiptExpectedCount > 0
            ? "text-foreground"
            : "text-muted-foreground/50 hover:text-muted-foreground",
        )}
        aria-label="Receipts"
        title={
          row.receiptExpectedCount > 0
            ? `${row.receiptExpectedCount} receipt(s) expected`
            : "No receipt attached"
        }
        onClick={(e) => {
          e.stopPropagation();
          meta.openDialog({ kind: "receipts", row });
        }}
      >
        <Paperclip className="h-4 w-4" />
      </button>
      {row.userNote ? (
        <button
          type="button"
          className="text-foreground rounded p-0.5"
          aria-label="Has a note"
          title={row.userNote}
          onClick={(e) => {
            e.stopPropagation();
            meta.openSheet(row);
          }}
        >
          <StickyNote className="h-4 w-4" />
        </button>
      ) : null}
      <ProvenancePopover row={row} />
    </span>
  );
}

function RowMenu({ row, meta }: { row: LedgerRow; meta: GridMeta }) {
  const editable = meta.canEditRow(row);
  const primary = row.primaryLineId ? row.lines.find((l) => l.id === row.primaryLineId) : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Row actions"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => meta.openSheet(row)}>Open details</DropdownMenuItem>
        {editable ? (
          <DropdownMenuItem onSelect={() => meta.openDialog({ kind: "edit", row })}>
            Edit
          </DropdownMenuItem>
        ) : null}
        {editable && row.kind === "BANK" && primary && !row.isSplit ? (
          <DropdownMenuItem onSelect={() => meta.openDialog({ kind: "split", row, line: primary })}>
            Split…
          </DropdownMenuItem>
        ) : null}
        {editable && row.splitRootLineId ? (
          <DropdownMenuItem onSelect={() => meta.openDialog({ kind: "unsplit", row })}>
            Unsplit…
          </DropdownMenuItem>
        ) : null}
        {editable && (row.status === "DRAFT" || row.status === "FLAGGED") ? (
          <DropdownMenuItem onSelect={() => meta.openDialog({ kind: "post", row })}>
            Post
          </DropdownMenuItem>
        ) : null}
        {editable ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => meta.openDialog({ kind: "void", row })}
            >
              Void…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function JournalLinesTable({
  rows,
  selectedId,
  onSelect,
  onOpen,
}: {
  rows: LedgerRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (row: LedgerRow) => void;
}) {
  let dr = 0;
  let cr = 0;
  for (const r of rows) {
    if (r.status === "VOIDED") continue;
    for (const l of r.lines) {
      dr += l.debitCents;
      cr += l.creditCents;
    }
  }
  return (
    <div className="bg-card overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-card text-muted-foreground sticky top-0 z-[1] border-b text-xs">
          <tr>
            <th className="h-9 px-2 text-left font-medium">Date</th>
            <th className="h-9 px-2 text-left font-medium">#</th>
            <th className="h-9 px-2 text-left font-medium">Vendor</th>
            <th className="h-9 px-2 text-left font-medium">Line</th>
            <th className="h-9 px-2 text-left font-medium">Account</th>
            <th className="h-9 px-2 text-left font-medium">Class</th>
            <th className="h-9 px-2 text-left font-medium">Entity</th>
            <th className="h-9 px-2 text-right font-medium">Debit</th>
            <th className="h-9 px-2 text-right font-medium">Credit</th>
            <th className="h-9 px-2 text-left font-medium">Memo</th>
            <th className="h-9 px-2 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap((r) =>
            r.lines.map((l, i) => (
              <tr
                key={l.id}
                id={i === 0 ? `ledger-row-${r.id}` : undefined}
                className={cn(
                  "hover:bg-muted/40 cursor-pointer border-b",
                  selectedId === r.id && "bg-accent/60",
                  i === 0 && "border-t-2",
                  l.isBridge && "text-amber-900",
                  r.status === "VOIDED" && "text-muted-foreground line-through",
                )}
                onClick={() => onSelect(r.id)}
                onDoubleClick={() => onOpen(r)}
              >
                <td className="tabular px-2 py-0.5 whitespace-nowrap">
                  {i === 0 ? formatDate(r.date) : ""}
                </td>
                <td className="tabular text-muted-foreground px-2 py-0.5">
                  {i === 0 ? r.seq : ""}
                </td>
                <td className="max-w-[12rem] truncate px-2 py-0.5 font-medium">
                  {i === 0 ? (r.vendor ?? "") : ""}
                </td>
                <td className="tabular text-muted-foreground px-2 py-0.5">{l.lineNo}</td>
                <td className="px-2 py-0.5 whitespace-nowrap">
                  {l.accountLabel}
                  {l.isBridge ? <span className="ml-1 text-[10px] uppercase">bridge</span> : null}
                </td>
                <td className="px-2 py-0.5 whitespace-nowrap">{l.classLabel}</td>
                <td className="px-2 py-0.5 text-xs">{l.entityCode ?? ""}</td>
                <td className="tabular px-2 py-0.5 text-right">
                  {l.debitCents ? money(l.debitCents) : ""}
                </td>
                <td className="tabular px-2 py-0.5 text-right">
                  {l.creditCents ? money(l.creditCents) : ""}
                </td>
                <td
                  className="text-muted-foreground max-w-[12rem] truncate px-2 py-0.5 text-xs"
                  title={l.memo ?? undefined}
                >
                  {l.memo ?? ""}
                </td>
                <td className="px-2 py-0.5">{i === 0 ? <StatusChip status={r.status} /> : null}</td>
              </tr>
            )),
          )}
        </tbody>
        <tfoot className="bg-muted/40 border-t text-xs">
          <tr>
            <td colSpan={7} className="px-2 py-2">
              {rows.length} transactions on this page (voided excluded from totals)
            </td>
            <td className="tabular px-2 py-2 text-right font-medium">{money(dr)}</td>
            <td className="tabular px-2 py-2 text-right font-medium">{money(cr)}</td>
            <td
              colSpan={2}
              className={cn("px-2 py-2", dr === cr ? "text-emerald-700" : "text-destructive")}
            >
              {dr === cr ? "Debits equal credits" : "Out of balance"}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SaveViewDialog({
  onClose,
  onSaved,
  state,
}: {
  onClose: () => void;
  onSaved: (views: SavedViewRow[], name: string) => void;
  state: ViewState;
}) {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save this view</DialogTitle>
          <DialogDescription>
            Keeps the current search, filters, sort and page size under a name, for you only.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const r = await saveViewAction({ name, state });
              if (r.error) {
                setError(r.error);
                return;
              }
              if (r.views) onSaved(r.views, name.trim().replace(/\s+/g, " "));
              onClose();
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="view-name">Name</Label>
            <Input
              id="view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Drafts to review"
              autoFocus
              maxLength={60}
              required
            />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? "Saving…" : "Save view"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
