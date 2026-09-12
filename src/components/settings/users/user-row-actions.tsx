"use client";

import { useCallback, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { PermissionKey, Role } from "@/lib/auth/permissions";
import type { UserAbilities } from "@/lib/users";
import {
  changeOwnerAction,
  removeUserAction,
  resetMfaAction,
  setTemporaryPasswordAction,
  unlockUserAction,
  updateUserAction,
} from "@/server/actions/users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ActionForm } from "./action-form";
import { RoleFields } from "./role-fields";

/** Plain, serialisable description of one row (dates are pre-formatted on the server). */
export type UserRowData = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  permissions: string[];
  isActive: boolean;
  abilities: UserAbilities;
};

type Which = "edit" | "password" | "mfa" | "unlock" | "remove" | "owner" | null;

export function UserRowActions({
  user,
  roles,
  grantable,
}: {
  user: UserRowData;
  roles: Role[];
  grantable: PermissionKey[];
}) {
  const [open, setOpen] = useState<Which>(null);
  const close = useCallback(() => setOpen(null), []);
  const a = user.abilities;
  const anything =
    a.canEdit || a.canSetPassword || a.canResetMfa || a.canUnlock || a.canRemove || a.canMakeOwner;
  if (!anything) return null;
  const ownerOnly = a.canRemove || a.canMakeOwner;
  const dialogProps = (which: Which) => ({
    open: open === which,
    onOpenChange: (o: boolean) => !o && close(),
  });

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${user.displayName}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {a.canEdit ? (
            <DropdownMenuItem onSelect={() => setOpen("edit")}>Edit</DropdownMenuItem>
          ) : null}
          {a.canSetPassword ? (
            <DropdownMenuItem onSelect={() => setOpen("password")}>
              Set temporary password
            </DropdownMenuItem>
          ) : null}
          {a.canResetMfa ? (
            <DropdownMenuItem onSelect={() => setOpen("mfa")}>
              Reset authenticator (MFA)
            </DropdownMenuItem>
          ) : null}
          {a.canUnlock ? (
            <DropdownMenuItem onSelect={() => setOpen("unlock")}>Unlock account</DropdownMenuItem>
          ) : null}
          {ownerOnly ? <DropdownMenuSeparator /> : null}
          {a.canMakeOwner ? (
            <DropdownMenuItem onSelect={() => setOpen("owner")}>
              Make this person the Owner…
            </DropdownMenuItem>
          ) : null}
          {a.canRemove ? (
            <DropdownMenuItem variant="destructive" onSelect={() => setOpen("remove")}>
              Remove user…
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog {...dialogProps("edit")}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit {user.displayName}</DialogTitle>
            <DialogDescription>
              {user.email}. Turning the account off signs them out everywhere and blocks sign-in
              until it is turned back on.
            </DialogDescription>
          </DialogHeader>
          <ActionForm action={updateUserAction} onDone={close} submitLabel="Save changes">
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="wasActive" value={user.isActive ? "on" : ""} />
            <div className="space-y-2">
              <Label htmlFor={`name-${user.id}`}>Name</Label>
              <Input
                id={`name-${user.id}`}
                name="displayName"
                defaultValue={user.displayName}
                required
                maxLength={100}
                autoFocus
              />
            </div>
            <RoleFields
              roles={roles}
              grantable={grantable}
              initialRole={user.role}
              initialPermissions={user.permissions}
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="isActive" defaultChecked={user.isActive} />
              Account is active (can sign in)
            </label>
          </ActionForm>
        </DialogContent>
      </Dialog>

      <Dialog {...dialogProps("password")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set a temporary password for {user.displayName}</DialogTitle>
            <DialogDescription>
              They are signed out everywhere and any lock is cleared. Share the new password with
              them privately; they should change it after signing in.
            </DialogDescription>
          </DialogHeader>
          <ActionForm action={setTemporaryPasswordAction} onDone={close} submitLabel="Set password">
            <input type="hidden" name="userId" value={user.id} />
            <div className="space-y-2">
              <Label htmlFor={`pw-${user.id}`}>Temporary password</Label>
              <Input
                id={`pw-${user.id}`}
                name="password"
                type="text"
                autoComplete="off"
                required
                autoFocus
              />
              <p className="text-muted-foreground text-xs">
                At least 12 characters with upper- and lower-case letters and a number.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`pw2-${user.id}`}>Temporary password again</Label>
              <Input id={`pw2-${user.id}`} name="confirm" type="text" autoComplete="off" required />
            </div>
          </ActionForm>
        </DialogContent>
      </Dialog>

      <Dialog {...dialogProps("mfa")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset the authenticator for {user.displayName}</DialogTitle>
            <DialogDescription>
              Use this when they have lost their phone. Their authenticator and recovery codes stop
              working, they are signed out everywhere, and they set up a new authenticator the next
              time they sign in.
            </DialogDescription>
          </DialogHeader>
          <ActionForm
            action={resetMfaAction}
            onDone={close}
            submitLabel="Reset authenticator"
            destructive
          >
            <input type="hidden" name="userId" value={user.id} />
            <ReasonField
              id={`mfa-reason-${user.id}`}
              placeholder="e.g. Lost phone, confirmed by phone call"
            />
          </ActionForm>
        </DialogContent>
      </Dialog>

      <Dialog {...dialogProps("unlock")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlock {user.displayName}</DialogTitle>
            <DialogDescription>
              The account was locked after too many wrong passwords or codes. Unlocking lets them
              try again right away with their existing password.
            </DialogDescription>
          </DialogHeader>
          <ActionForm
            action={unlockUserAction}
            onDone={close}
            submitLabel="Unlock"
            pendingLabel="Unlocking…"
          >
            <input type="hidden" name="userId" value={user.id} />
          </ActionForm>
        </DialogContent>
      </Dialog>

      <Dialog {...dialogProps("remove")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {user.displayName}</DialogTitle>
            <DialogDescription>
              This is permanent. {user.email} loses access for good, is signed out everywhere, and
              cannot be reactivated — you would have to add them again as a new user. Their name
              stays on everything they did, so the history is untouched.
            </DialogDescription>
          </DialogHeader>
          <ActionForm
            action={removeUserAction}
            onDone={close}
            submitLabel="Remove permanently"
            pendingLabel="Removing…"
            destructive
          >
            <input type="hidden" name="userId" value={user.id} />
            <ReasonField
              id={`remove-reason-${user.id}`}
              placeholder="e.g. No longer works with us"
            />
          </ActionForm>
        </DialogContent>
      </Dialog>

      <Dialog {...dialogProps("owner")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make {user.displayName} the Owner</DialogTitle>
            <DialogDescription>
              {user.displayName} becomes the Owner of these books and you become a Full-access user.
              Only they will be able to remove users, hand ownership on, or reopen closed years.
              There is no undo from your side — only the new Owner can give it back.
            </DialogDescription>
          </DialogHeader>
          <ActionForm
            action={changeOwnerAction}
            onDone={close}
            submitLabel="Transfer ownership"
            pendingLabel="Transferring…"
            destructive
          >
            <input type="hidden" name="userId" value={user.id} />
            <ReasonField id={`owner-reason-${user.id}`} placeholder="e.g. Handing the books over" />
            <div className="space-y-2">
              <Label htmlFor={`owner-confirm-${user.id}`}>
                Type <span className="font-mono">{user.email}</span> to confirm
              </Label>
              <Input
                id={`owner-confirm-${user.id}`}
                name="confirmEmail"
                autoComplete="off"
                required
              />
            </div>
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReasonField({ id, placeholder }: { id: string; placeholder: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Reason (kept in the activity log)</Label>
      <Textarea
        id={id}
        name="reason"
        required
        minLength={3}
        maxLength={500}
        rows={2}
        placeholder={placeholder}
        autoFocus
      />
    </div>
  );
}
