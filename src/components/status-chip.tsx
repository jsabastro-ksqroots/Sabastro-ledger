import { cn } from "@/lib/utils";

const STYLES: Record<string, string> = {
  OPEN: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  CLOSED: "bg-amber-50 text-amber-800 ring-amber-600/20",
  FILED: "bg-slate-100 text-slate-700 ring-slate-500/20",
  DRAFT: "bg-slate-100 text-slate-700 ring-slate-500/20",
  FLAGGED: "bg-amber-50 text-amber-800 ring-amber-600/20",
  POSTED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  VOIDED: "bg-red-50 text-red-700 ring-red-600/20",
  ACTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  INACTIVE: "bg-slate-100 text-slate-500 ring-slate-500/20",
};

const LABELS: Record<string, string> = {
  OPEN: "Open",
  CLOSED: "Closed",
  FILED: "Filed",
  DRAFT: "Draft",
  FLAGGED: "Flagged",
  POSTED: "Posted",
  VOIDED: "Voided",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
};

export function StatusChip({
  status,
  label,
  className,
}: {
  status: string;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        STYLES[status] ?? STYLES.INACTIVE,
        className,
      )}
    >
      {label ?? LABELS[status] ?? status}
    </span>
  );
}
