"use client";

import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import type { PermissionKey, Role } from "@/lib/auth/permissions";
import { createUserAction } from "@/server/actions/users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ActionForm } from "./action-form";
import { RoleFields } from "./role-fields";

export function AddUserDialog({ roles, grantable }: { roles: Role[]; grantable: PermissionKey[] }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const defaultRole: Role = roles.includes("LIMITED") ? "LIMITED" : (roles[0] ?? "VIEW_ONLY");
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Add user
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add a user</DialogTitle>
            <DialogDescription>
              Give them a temporary password to sign in with the first time. They will be asked to
              set up an authenticator app on their phone before they can see anything.
            </DialogDescription>
          </DialogHeader>
          <ActionForm
            action={createUserAction}
            onDone={close}
            submitLabel="Add user"
            pendingLabel="Adding…"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-name">Name</Label>
                <Input
                  id="new-name"
                  name="displayName"
                  autoComplete="off"
                  required
                  autoFocus
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-email">Email</Label>
                <Input
                  id="new-email"
                  name="email"
                  type="email"
                  autoComplete="off"
                  required
                  maxLength={200}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">Temporary password</Label>
              <Input id="new-password" name="password" type="text" autoComplete="off" required />
              <p className="text-muted-foreground text-xs">
                At least 12 characters with upper- and lower-case letters and a number. Share it
                with them privately.
              </p>
            </div>
            <RoleFields roles={roles} grantable={grantable} initialRole={defaultRole} />
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}
