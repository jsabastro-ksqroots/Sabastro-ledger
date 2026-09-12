import { describe, expect, it } from "vitest";
import {
  actorHasManageUsers,
  assignableRoles,
  canManageUser,
  grantablePermissions,
  isRemovedUser,
  userAbilities,
} from "@/lib/users";

const now = new Date("2026-09-12T12:00:00Z");
const later = new Date(now.getTime() + 60_000);
const earlier = new Date(now.getTime() - 60_000);

const jose = { id: "owner", role: "OWNER" as const };
const jamin = { id: "full", role: "FULL" as const };
const limAdmin = {
  id: "limadmin",
  role: "LIMITED" as const,
  permissions: ["MANAGE_USERS", "VIEW_LEDGER"],
};
const limPlain = { id: "limplain", role: "LIMITED" as const, permissions: ["VIEW_LEDGER"] };
const viewer = { id: "viewer", role: "VIEW_ONLY" as const };

const target = (
  id: string,
  role: "OWNER" | "FULL" | "LIMITED" | "VIEW_ONLY",
  extra: Partial<{
    isActive: boolean;
    lockedUntil: Date | null;
    mfaEnrolledAt: Date | null;
    passwordHash: string;
  }> = {},
) => ({
  id,
  role,
  isActive: true,
  lockedUntil: null,
  mfaEnrolledAt: now,
  passwordHash: "$argon2id$x",
  ...extra,
});

describe("who may manage whom (pure helpers behind the Users tab)", () => {
  it("only users holding Manage users can manage anyone", () => {
    expect(actorHasManageUsers(jose)).toBe(true);
    expect(actorHasManageUsers(jamin)).toBe(true);
    expect(actorHasManageUsers(limAdmin)).toBe(true);
    expect(actorHasManageUsers(limPlain)).toBe(false);
    expect(actorHasManageUsers(viewer)).toBe(false);
    expect(canManageUser(limPlain, target("x", "VIEW_ONLY"))).toBe(false);
    expect(assignableRoles(viewer)).toEqual([]);
    expect(grantablePermissions(limPlain)).toEqual([]);
  });

  it("follows the ladder: below your own level, Limited may manage Limited, nobody touches self or the Owner", () => {
    expect(canManageUser(jose, target("full", "FULL"))).toBe(true);
    expect(canManageUser(jose, target("owner", "OWNER"))).toBe(false);
    expect(canManageUser(jamin, target("full2", "FULL"))).toBe(false);
    expect(canManageUser(jamin, target("lim", "LIMITED"))).toBe(true);
    expect(canManageUser(jamin, target("full", "FULL"))).toBe(false); // self
    expect(canManageUser(limAdmin, target("lim2", "LIMITED"))).toBe(true);
    expect(canManageUser(limAdmin, target("v", "VIEW_ONLY"))).toBe(true);
    expect(canManageUser(limAdmin, target("full", "FULL"))).toBe(false);
  });

  it("offers only the roles and permissions the actor may hand out", () => {
    expect(assignableRoles(jose)).toEqual(["FULL", "LIMITED", "VIEW_ONLY"]);
    expect(assignableRoles(jamin)).toEqual(["LIMITED", "VIEW_ONLY"]);
    expect(assignableRoles(limAdmin)).toEqual(["LIMITED", "VIEW_ONLY"]);
    expect(grantablePermissions(jose).length).toBe(10);
    expect(grantablePermissions(limAdmin).sort()).toEqual(["MANAGE_USERS", "VIEW_LEDGER"]);
  });

  it("computes per-row abilities, with Remove and Make owner reserved for the Owner", () => {
    const lim = target("lim", "LIMITED");
    const asOwner = userAbilities(jose, lim, now);
    expect(asOwner).toEqual({
      canEdit: true,
      canSetPassword: true,
      canResetMfa: true,
      canUnlock: false,
      canRemove: true,
      canMakeOwner: true,
    });
    const asFull = userAbilities(jamin, lim, now);
    expect(asFull.canEdit).toBe(true);
    expect(asFull.canRemove).toBe(false);
    expect(asFull.canMakeOwner).toBe(false);
    // the Owner's own row and your own row offer nothing
    expect(
      Object.values(userAbilities(jamin, target("owner", "OWNER"), now)).every((v) => v === false),
    ).toBe(true);
    expect(
      Object.values(userAbilities(jose, target("owner", "OWNER"), now)).every((v) => v === false),
    ).toBe(true);
  });

  it("shows Unlock only while a lock is in the future, Reset MFA only once enrolled, and nothing for removed users", () => {
    expect(
      userAbilities(jose, target("a", "VIEW_ONLY", { lockedUntil: later }), now).canUnlock,
    ).toBe(true);
    expect(
      userAbilities(jose, target("a", "VIEW_ONLY", { lockedUntil: earlier }), now).canUnlock,
    ).toBe(false);
    expect(
      userAbilities(jose, target("a", "VIEW_ONLY", { mfaEnrolledAt: null }), now).canResetMfa,
    ).toBe(false);
    const inactive = userAbilities(jose, target("a", "VIEW_ONLY", { isActive: false }), now);
    expect(inactive.canEdit).toBe(true); // to reactivate
    expect(inactive.canSetPassword).toBe(false);
    expect(inactive.canMakeOwner).toBe(false);
    expect(inactive.canRemove).toBe(true);
    const removed = target("a", "VIEW_ONLY", { isActive: false, passwordHash: "!removed" });
    expect(isRemovedUser(removed)).toBe(true);
    expect(Object.values(userAbilities(jose, removed, now)).every((v) => v === false)).toBe(true);
  });
});
