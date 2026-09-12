import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActivityFilters } from "@/lib/activity";

/**
 * Plain GET form — no JavaScript needed. Submitting reloads /settings/activity with the filters in the
 * URL, so a filtered view can be bookmarked or pasted to the other user.
 */
export function ActivityFilterForm({
  filters,
  users,
  actions,
  entities,
}: {
  filters: ActivityFilters;
  users: { id: string; displayName: string; email: string; isActive: boolean }[];
  actions: string[];
  entities: { id: string; code: string; name: string }[];
}) {
  const hasAny = Object.values(filters).some((v) => v !== undefined && v !== "");
  return (
    <form method="get" action="/settings/activity" className="bg-card mb-4 rounded-lg border p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="User" htmlFor="userId">
          <NativeSelect id="userId" name="userId" defaultValue={filters.userId ?? ""}>
            <option value="">Anyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
                {u.isActive ? "" : " (inactive)"}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Action" htmlFor="action">
          <NativeSelect id="action" name="action" defaultValue={filters.action ?? ""}>
            <option value="">Any action</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Action starts with" htmlFor="actionPrefix" hint='e.g. "login." or "user."'>
          <Input
            id="actionPrefix"
            name="actionPrefix"
            defaultValue={filters.actionPrefix ?? ""}
            placeholder="login."
            className="font-mono text-xs"
          />
        </Field>
        <Field label="Entity" htmlFor="entityId">
          <NativeSelect id="entityId" name="entityId" defaultValue={filters.entityId ?? ""}>
            <option value="">Any entity</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.code} · {e.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="From" htmlFor="from">
          <Input id="from" name="from" type="date" defaultValue={filters.from ?? ""} />
        </Field>
        <Field label="To" htmlFor="to">
          <Input id="to" name="to" type="date" defaultValue={filters.to ?? ""} />
        </Field>
        <Field label="Contains text" htmlFor="text" hint="Matches the subject, reason or action">
          <Input
            id="text"
            name="text"
            defaultValue={filters.text ?? ""}
            placeholder="e.g. jamin@ or 2025"
          />
        </Field>
        <div className="flex items-end pb-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="overridesOnly"
              value="1"
              aria-label="Closed-year overrides only"
              defaultChecked={!!filters.isLockOverride}
              className="border-input accent-primary size-4 rounded"
            />
            Closed-year overrides only
          </label>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button type="submit" size="sm">
          Apply filters
        </Button>
        {hasAny ? (
          <Button asChild variant="ghost" size="sm">
            <Link href="/settings/activity">Clear</Link>
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

/** Styled like <Input>; a native select so the GET form works without client JavaScript. */
function NativeSelect(props: React.ComponentProps<"select">) {
  return (
    <select
      {...props}
      className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
    />
  );
}
