"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  CalendarCheck,
  Inbox,
  Landmark,
  LayoutDashboard,
  Receipt,
  Settings,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: string; icon: LucideIcon; badgeKey?: "review" }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/review", label: "Review", icon: Inbox, badgeKey: "review" },
  { href: "/ledger", label: "Ledger", icon: BookOpen },
  { href: "/receipts", label: "Receipts", icon: Receipt },
  { href: "/statements", label: "Statements", icon: Landmark },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/performance", label: "Performance", icon: TrendingUp },
  { href: "/tax-years", label: "Tax Years / History", icon: CalendarCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SidebarNav({ badges }: { badges: { review: number } }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 px-2" aria-label="Main">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const badge = item.badgeKey ? badges[item.badgeKey] : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              active && "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">{item.label}</span>
            {badge > 0 ? (
              <span className="bg-sidebar-primary text-sidebar-primary-foreground rounded-full px-2 py-0.5 text-xs font-semibold">
                {badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
