"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Search box (GET param `q`) and the "show inactive" toggle (GET param `inactive=1`). */
export function AccountsToolbar({
  search,
  showInactive,
}: {
  search: string;
  showInactive: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState(search);

  function go(next: { q?: string; inactive?: boolean }) {
    const params = new URLSearchParams();
    const query = (next.q ?? q).trim();
    const inactive = next.inactive ?? showInactive;
    if (query) params.set("q", query);
    if (inactive) params.set("inactive", "1");
    const qs = params.toString();
    router.push(qs ? `/settings/accounts?${qs}` : "/settings/accounts");
  }

  return (
    <form
      className="mb-4 flex flex-wrap items-center gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        go({});
      }}
    >
      <div className="relative">
        <SearchIcon
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search number, name or note"
          className="w-72 pl-8"
          aria-label="Search accounts"
        />
      </div>
      <Button type="submit" variant="outline" size="sm">
        Search
      </Button>
      {search ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            go({ q: "" });
          }}
        >
          Clear
        </Button>
      ) : null}
      <label className="text-muted-foreground ml-auto flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="border-input accent-primary size-4 rounded"
          checked={showInactive}
          onChange={(e) => go({ inactive: e.target.checked })}
        />
        Show inactive accounts
      </label>
    </form>
  );
}
