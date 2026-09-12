import Link from "next/link";
import { db } from "@/lib/db";
import { requireFullSession } from "@/lib/auth/current-user";
import { getUiScope } from "@/lib/ui-scope";
import { PageHeader } from "@/components/shell/page-header";
import { StatusChip } from "@/components/status-chip";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ recovery_left?: string }>;
}) {
  const params = await searchParams;
  const user = await requireFullSession();
  const scope = await getUiScope();
  const [accounts, classes, lastLogin] = await Promise.all([
    db.account.count({ where: { isActive: true } }),
    db.class.count({ where: { isActive: true } }),
    db.auditLog.findFirst({
      where: { userId: user.id, action: "login.success" },
      orderBy: { at: "desc" },
      skip: 1,
    }),
  ]);
  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user.displayName.split(" ")[0]}`}
        helper="This is the home screen. Once transactions exist it shows what needs your attention this week."
      />
      {params.recovery_left ? (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You signed in with a recovery code and have {params.recovery_left} left. Generate a new
          set from Settings → Users soon.
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Working in</CardDescription>
            <CardTitle className="text-lg">
              {scope.entity ? `${scope.entity.code} · ${scope.entity.name}` : "No entity"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Tax year{" "}
            {scope.year ? (
              <>
                {scope.year.year} <StatusChip status={scope.year.state} />
              </>
            ) : (
              "—"
            )}
            . Change either in the top bar.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Chart of accounts</CardDescription>
            <CardTitle className="tabular text-lg">{accounts} active accounts</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            {classes} active classes.{" "}
            <Link href="/settings/accounts" className="underline underline-offset-4">
              Browse the chart
            </Link>
            .
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Your previous sign-in</CardDescription>
            <CardTitle className="text-lg">
              {lastLogin ? formatDateTime(lastLogin.at) : "This is your first"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Every sign-in is recorded.{" "}
            <Link href="/settings/activity" className="underline underline-offset-4">
              See the Activity log
            </Link>
            .
          </CardContent>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">What is built so far (Phase 0)</CardTitle>
          <CardDescription>
            Sign-in with authenticator codes, roles and permissions, the audit log, entities, bank
            accounts, the chart of accounts, classes and tax years.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Next: Phase 1 adds the ledger itself — journal entries, splits, the tax-year lock and the
          ledger grid. The greyed-out sections in the sidebar are placeholders until then.
        </CardContent>
      </Card>
    </div>
  );
}
