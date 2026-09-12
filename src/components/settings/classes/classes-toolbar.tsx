"use client";

import { useRouter } from "next/navigation";

/** The "show inactive" toggle (GET param `inactive=1`). */
export function ClassesToolbar({ showInactive }: { showInactive: boolean }) {
  const router = useRouter();
  return (
    <div className="mb-4 flex items-center justify-end">
      <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="border-input accent-primary size-4 rounded"
          checked={showInactive}
          onChange={(e) =>
            router.push(e.target.checked ? "/settings/classes?inactive=1" : "/settings/classes")
          }
        />
        Show inactive classes
      </label>
    </div>
  );
}
