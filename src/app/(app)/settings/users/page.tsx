import { Users } from "lucide-react";
import { db } from "@/lib/db";
import { requireFullSession } from "@/lib/auth/current-user";
import {
  PERMISSION_LABELS,
  ROLE_LABELS,
  type PermissionKey,
  type Role,
} from "@/lib/auth/permissions";
import {
  actorHasManageUsers,
  assignableRoles,
  grantablePermissions,
  isRemovedUser,
  listUsers,
  userAbilities,
} from "@/lib/users";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";
import { StatusChip } from "@/components/status-chip";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MyAccountActions } from "@/components/settings/users/my-account-actions";
import { AddUserDialog } from "@/components/settings/users/add-user-dialog";
import { UserRowActions } from "@/components/settings/users/user-row-actions";

export const metadata = { title: "Users · Settings" };

export default async function UsersSettingsPage() {
  const me = await requireFullSession();
  const now = new Date();
  const [users, liveByUser] = await Promise.all([
    listUsers(db),
    db.session.groupBy({
      by: ["userId"],
      where: { revokedAt: null, expiresAt: { gt: now } },
      _count: { _all: true },
    }),
  ]);
  const live = new Map(liveByUser.map((r) => [r.userId, r._count._all]));
  const actor = { id: me.id, role: me.role as Role, permissions: me.permissions };
  const canManage = actorHasManageUsers(actor);
  const roles = assignableRoles(actor);
  const grantable = grantablePermissions(actor);
  const myRow = users.find((u) => u.id === me.id);

  return (
    <div>
      <PageHeader
        title="Users"
        helper="Your own account first, then everyone who can sign in. Only the Owner can remove a user or hand over ownership."
        actions={
          canManage && roles.length > 0 ? (
            <AddUserDialog roles={roles} grantable={grantable} />
          ) : undefined
        }
      />

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardDescription>My account</CardDescription>
          <CardTitle className="text-lg">{me.displayName}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{me.email}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Access level</dt>
              <dd>{ROLE_LABELS[me.role as Role]}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Authenticator set up</dt>
              <dd>{myRow?.mfaEnrolledAt ? formatDateTime(myRow.mfaEnrolledAt) : "Not yet"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Open sessions</dt>
              <dd className="tabular">{live.get(me.id) ?? 0}</dd>
            </div>
          </dl>
          <MyAccountActions liveSessions={live.get(me.id) ?? 0} />
        </CardContent>
      </Card>

      {!canManage ? (
        <p className="text-muted-foreground mb-3 text-sm">
          You can see who has access but not change it. Ask the Owner or a Full-access user for
          changes.
        </p>
      ) : null}

      {users.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No users yet"
          description="Add the first user with the button above."
        />
      ) : (
        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Authenticator</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead className="text-right">Sessions</TableHead>
                {canManage ? <TableHead className="w-10" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const removed = isRemovedUser(u);
                const locked = !!u.lockedUntil && u.lockedUntil.getTime() > now.getTime();
                const permissions = u.permissions.map((p) => p.permission as PermissionKey);
                const abilities = userAbilities(actor, u, now);
                return (
                  <TableRow key={u.id} className={u.isActive ? undefined : "text-muted-foreground"}>
                    <TableCell className="font-medium">
                      {u.displayName}
                      {u.id === me.id ? (
                        <span className="text-muted-foreground ml-2 text-xs font-normal">
                          (you)
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <div>{ROLE_LABELS[u.role as Role]}</div>
                      {u.role === "LIMITED" ? (
                        <div className="text-muted-foreground mt-0.5 max-w-xs text-xs">
                          {permissions.length
                            ? permissions.map((p) => PERMISSION_LABELS[p] ?? p).join(" · ")
                            : "No permissions ticked"}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.mfaEnrolledAt ? formatDateTime(u.mfaEnrolledAt) : "Not yet"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {removed ? (
                          <StatusChip status="INACTIVE" label="Removed" />
                        ) : (
                          <StatusChip status={u.isActive ? "ACTIVE" : "INACTIVE"} />
                        )}
                        {locked ? (
                          <StatusChip
                            status="FLAGGED"
                            label={`Locked until ${formatDateTime(u.lockedUntil)}`}
                          />
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}
                    </TableCell>
                    <TableCell className="tabular text-right">{live.get(u.id) ?? 0}</TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <UserRowActions
                          user={{
                            id: u.id,
                            email: u.email,
                            displayName: u.displayName,
                            role: u.role as Role,
                            permissions,
                            isActive: u.isActive,
                            abilities,
                          }}
                          roles={roles}
                          grantable={grantable}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
