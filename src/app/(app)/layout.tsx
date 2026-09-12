import { requireFullSession } from "@/lib/auth/current-user";
import { getUiScope } from "@/lib/ui-scope";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { ScopeSwitchers } from "@/components/shell/scope-switchers";
import { UserMenu } from "@/components/shell/user-menu";
import { TooltipProvider } from "@/components/ui/tooltip";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireFullSession();
  const scope = await getUiScope();
  return (
    <TooltipProvider>
      <div className="flex min-h-screen">
        <aside className="bg-sidebar text-sidebar-foreground hidden w-60 shrink-0 flex-col md:flex">
          <div className="px-5 py-5">
            <div className="text-sidebar-primary text-sm font-semibold tracking-tight">
              Sabastro Ledger
            </div>
            <div className="text-sidebar-foreground/60 text-xs">Books for SREI and PLA</div>
          </div>
          <SidebarNav badges={{ review: 0 }} />
          <div className="text-sidebar-foreground/50 mt-auto px-5 py-4 text-xs">
            Phase 0 · shell
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="bg-card sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b px-4">
            <ScopeSwitchers scope={scope} />
            <UserMenu name={user.displayName} roleLabel={ROLE_LABELS[user.role]} />
          </header>
          <main className="flex-1 px-6 py-6">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}
