"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { selectEntityAction, selectYearAction } from "@/server/actions/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UiScope } from "@/lib/ui-scope";

export function ScopeSwitchers({ scope }: { scope: UiScope }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2" aria-busy={pending}>
      <Select
        value={scope.entity?.code ?? ""}
        onValueChange={(code) =>
          start(async () => {
            await selectEntityAction(code);
            router.refresh();
          })
        }
      >
        <SelectTrigger className="h-8 w-[280px]" aria-label="Entity">
          <SelectValue placeholder="Entity" />
        </SelectTrigger>
        <SelectContent>
          {scope.entities.map((e) => (
            <SelectItem key={e.id} value={e.code}>
              <span className="font-medium">{e.code}</span>
              <span className="text-muted-foreground"> · {e.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={scope.year ? String(scope.year.year) : ""}
        onValueChange={(y) =>
          start(async () => {
            await selectYearAction(Number(y));
            router.refresh();
          })
        }
      >
        <SelectTrigger className="h-8 w-[150px]" aria-label="Tax year">
          <SelectValue placeholder="Tax year" />
        </SelectTrigger>
        <SelectContent>
          {scope.years.map((y) => (
            <SelectItem key={y.id} value={String(y.year)}>
              {y.year}
              <span className="text-muted-foreground">
                {" "}
                · {y.state === "OPEN" ? "open" : y.state === "CLOSED" ? "closed" : "filed"}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
