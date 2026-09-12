"use client";

import { useState } from "react";
import {
  PERMISSION_LABELS,
  ROLE_LABELS,
  type PermissionKey,
  type Role,
} from "@/lib/auth/permissions";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ROLE_HELP: Record<Role, string> = {
  OWNER: "Everything, including removing users and handing over ownership.",
  FULL: "Everything except removing users and changing the owner.",
  LIMITED: "Only the boxes ticked below.",
  VIEW_ONLY: "Can look at the ledger and run reports, nothing else.",
};

/** Role picker plus the permission checklist that appears only for Limited users. */
export function RoleFields({
  roles,
  grantable,
  initialRole,
  initialPermissions = [],
}: {
  roles: Role[];
  grantable: PermissionKey[];
  initialRole: Role;
  initialPermissions?: string[];
}) {
  const [role, setRole] = useState<Role>(initialRole);
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="role">Access level</Label>
        <Select name="role" value={role} onValueChange={(v) => setRole(v as Role)}>
          <SelectTrigger id="role" className="w-full">
            <SelectValue placeholder="Choose an access level" />
          </SelectTrigger>
          <SelectContent>
            {roles.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">{ROLE_HELP[role]}</p>
      </div>
      {role === "LIMITED" ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">What this person can do</legend>
          <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
            {grantable.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <Checkbox
                  name="permissions"
                  value={p}
                  defaultChecked={initialPermissions.includes(p)}
                />
                {PERMISSION_LABELS[p]}
              </label>
            ))}
          </div>
          {grantable.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              You have no permissions you could pass on.
            </p>
          ) : null}
        </fieldset>
      ) : null}
    </>
  );
}
