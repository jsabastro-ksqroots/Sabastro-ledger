"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings/users", label: "Users" },
  { href: "/settings/activity", label: "Activity" },
  { href: "/settings/entities", label: "Entities & bank accounts" },
  { href: "/settings/accounts", label: "Chart of accounts" },
  { href: "/settings/classes", label: "Classes" },
  { href: "/settings/data", label: "Data" },
];
const LATER = ["AI", "Models", "Tax mapping"];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap items-center gap-1 border-b">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "text-muted-foreground hover:text-foreground -mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              active ? "border-primary text-foreground font-medium" : "border-transparent",
            )}
          >
            {t.label}
          </Link>
        );
      })}
      {LATER.map((l) => (
        <span
          key={l}
          className="text-muted-foreground/50 -mb-px cursor-not-allowed border-b-2 border-transparent px-3 py-2 text-sm"
          title="Coming in a later phase"
        >
          {l}
        </span>
      ))}
    </div>
  );
}
