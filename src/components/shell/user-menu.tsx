"use client";

import Link from "next/link";
import { ChevronDown, LogOut, ShieldOff, UserCircle } from "lucide-react";
import { signOutAction, signOutEverywhereAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ name, roleLabel }: { name: string; roleLabel: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <UserCircle className="h-4 w-4" aria-hidden />
          <span className="max-w-[160px] truncate">{name}</span>
          <ChevronDown className="text-muted-foreground h-3 w-3" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <div className="text-sm font-medium">{name}</div>
          <div className="text-muted-foreground text-xs font-normal">{roleLabel}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/users">My account &amp; users</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <form action={signOutAction} className="w-full">
            <button type="submit" className="flex w-full items-center gap-2">
              <LogOut className="h-4 w-4" aria-hidden /> Sign out
            </button>
          </form>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <form action={signOutEverywhereAction} className="w-full">
            <button type="submit" className="flex w-full items-center gap-2">
              <ShieldOff className="h-4 w-4" aria-hidden /> Sign out everywhere
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
