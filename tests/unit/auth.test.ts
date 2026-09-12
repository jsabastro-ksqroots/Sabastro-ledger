import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, disconnectDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { loginWithPassword } from "@/lib/auth/login";
import { resolveSession, revokeAllSessions, SESSION_IDLE_MS } from "@/lib/auth/session";
import {
  beginMfaEnrollment,
  confirmMfaEnrollment,
  verifyMfaCode,
  verifyRecoveryCode,
} from "@/lib/auth/mfa";
import { currentTotpCode } from "@/lib/auth/totp";
import { FAILURE_THRESHOLD } from "@/lib/auth/lockout";
import { assertPermission, effectivePermissions, ForbiddenError } from "@/lib/auth/permissions";

const PASSWORD = "Correct-Horse-Battery-9";
const meta = { ip: "127.0.0.1", userAgent: "vitest" };

async function makeUser(tag: string, role: "OWNER" | "FULL" | "LIMITED" | "VIEW_ONLY" = "FULL") {
  const email = `auth-${tag}-${Date.now()}@test.local`;
  return db.user.create({
    data: { email, displayName: `Test ${tag}`, passwordHash: await hashPassword(PASSWORD), role },
  });
}

/** Password step + full enrollment; returns a fully verified session token and the TOTP secret. */
async function enrolledLogin(email: string) {
  const login = await loginWithPassword(db, { email, password: PASSWORD, ...meta });
  if (!login.ok) throw new Error("login failed");
  const actor = { userId: login.userId, sessionId: login.sessionId, ...meta };
  const enroll = await beginMfaEnrollment(db, actor);
  const confirmed = await confirmMfaEnrollment(db, actor, currentTotpCode(enroll.secret));
  if (!confirmed.ok) throw new Error("enrollment failed");
  return {
    login,
    actor,
    token: confirmed.token,
    secret: enroll.secret,
    recoveryCodes: confirmed.recoveryCodes,
  };
}

beforeAll(async () => {
  await db.$queryRaw`select 1`;
});

afterAll(async () => {
  await disconnectDb();
});

describe("password login", () => {
  it("creates a half-open session on a correct password and audits it", async () => {
    const user = await makeUser("ok");
    const result = await loginWithPassword(db, {
      email: user.email.toUpperCase(),
      password: PASSWORD,
      ...meta,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.needsEnrollment).toBe(true);
    const resolved = await resolveSession(db, result.token);
    expect(resolved?.user.id).toBe(user.id);
    expect(resolved?.session.mfaVerifiedAt).toBeNull();
    const audit = await db.auditLog.findFirst({
      where: { userId: user.id, action: "login.password_ok" },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects a wrong password and an unknown email the same way", async () => {
    const user = await makeUser("wrong");
    const bad = await loginWithPassword(db, {
      email: user.email,
      password: "nope-nope-nope-1A",
      ...meta,
    });
    expect(bad).toEqual({ ok: false, reason: "invalid" });
    const unknown = await loginWithPassword(db, {
      email: "nobody@test.local",
      password: PASSWORD,
      ...meta,
    });
    expect(unknown).toEqual({ ok: false, reason: "invalid" });
  });

  it("locks the account after repeated failures, even for the right password", async () => {
    const user = await makeUser("lock");
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await loginWithPassword(db, { email: user.email, password: "wrong-password-1A", ...meta });
    }
    const locked = await loginWithPassword(db, { email: user.email, password: PASSWORD, ...meta });
    expect(locked.ok).toBe(false);
    if (!locked.ok) {
      expect(locked.reason).toBe("locked");
      expect(locked.retryAfterSeconds).toBeGreaterThan(0);
    }
    const lockout = await db.auditLog.findFirst({
      where: { userId: user.id, action: "login.lockout" },
    });
    expect(lockout).not.toBeNull();
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lockedUntil).not.toBeNull();
    expect(row.lockoutCount).toBe(1);
  });

  it("refuses a deactivated user", async () => {
    const user = await makeUser("inactive");
    await db.user.update({ where: { id: user.id }, data: { isActive: false } });
    const result = await loginWithPassword(db, { email: user.email, password: PASSWORD, ...meta });
    expect(result).toEqual({ ok: false, reason: "inactive" });
  });
});

describe("MFA enrollment and verification", () => {
  it("enrols with a valid code, issues 10 recovery codes, and fully opens the session", async () => {
    const user = await makeUser("enrol");
    const { login, token, recoveryCodes } = await enrolledLogin(user.email);
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    // The pre-MFA token is dead; the rotated one is live and fully open.
    expect(await resolveSession(db, login.token)).toBeNull();
    const resolved = await resolveSession(db, token);
    expect(resolved?.session.mfaVerifiedAt).not.toBeNull();
    expect(resolved?.user.mfaEnrolledAt).not.toBeNull();
    const audit = await db.auditLog.findFirst({
      where: { userId: user.id, action: "mfa.enrolled" },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects a wrong enrollment code and keeps the user un-enrolled", async () => {
    const user = await makeUser("enrol-bad");
    const login = await loginWithPassword(db, { email: user.email, password: PASSWORD, ...meta });
    if (!login.ok) throw new Error("login failed");
    const actor = { userId: login.userId, sessionId: login.sessionId, ...meta };
    await beginMfaEnrollment(db, actor);
    const confirmed = await confirmMfaEnrollment(db, actor, "000000");
    expect(confirmed.ok).toBe(false);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.mfaEnrolledAt).toBeNull();
  });

  it("verifies a fresh code on the next login, blocks replay of a used code, and locks after repeated bad codes", async () => {
    const user = await makeUser("verify");
    const { secret } = await enrolledLogin(user.email);
    const login2 = await loginWithPassword(db, { email: user.email, password: PASSWORD, ...meta });
    if (!login2.ok) throw new Error("login failed");
    expect(login2.needsEnrollment).toBe(false);
    const actor = { userId: login2.userId, sessionId: login2.sessionId, ...meta };
    // The code used to enrol belongs to the current time step, so it must not be accepted again.
    const replay = await verifyMfaCode(db, actor, currentTotpCode(secret));
    expect(replay.ok).toBe(false);
    // A code from the next time step is fine.
    const later = new Date(Date.now() + 60_000);
    const ok = await verifyMfaCode(
      db,
      actor,
      currentTotpCode(secret, Math.floor(later.getTime() / 1000)),
      later,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect((await resolveSession(db, ok.token))?.session.mfaVerifiedAt).not.toBeNull();

    const login3 = await loginWithPassword(db, { email: user.email, password: PASSWORD, ...meta });
    if (!login3.ok) throw new Error("login failed");
    const actor3 = { userId: login3.userId, sessionId: login3.sessionId, ...meta };
    let last: Awaited<ReturnType<typeof verifyMfaCode>> = { ok: false, reason: "invalid" };
    for (let i = 0; i < FAILURE_THRESHOLD; i++) last = await verifyMfaCode(db, actor3, "123456");
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.reason).toBe("locked");
  });

  it("accepts each recovery code exactly once", async () => {
    const user = await makeUser("recovery");
    const { recoveryCodes } = await enrolledLogin(user.email);
    const login2 = await loginWithPassword(db, { email: user.email, password: PASSWORD, ...meta });
    if (!login2.ok) throw new Error("login failed");
    const actor = { userId: login2.userId, sessionId: login2.sessionId, ...meta };
    const code = recoveryCodes[0] as string;
    const first = await verifyRecoveryCode(db, actor, code.toLowerCase().replace("-", " "));
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.recoveryCodesRemaining).toBe(9);
    const login3 = await loginWithPassword(db, { email: user.email, password: PASSWORD, ...meta });
    if (!login3.ok) throw new Error("login failed");
    const again = await verifyRecoveryCode(
      db,
      { userId: login3.userId, sessionId: login3.sessionId, ...meta },
      code,
    );
    expect(again.ok).toBe(false);
  });
});

describe("sessions", () => {
  it("gives a half-open session only ten minutes", async () => {
    const user = await makeUser("halfopen");
    const login = await loginWithPassword(db, { email: user.email, password: PASSWORD, ...meta });
    if (!login.ok) throw new Error("login failed");
    const row = await db.session.findUniqueOrThrow({ where: { id: login.sessionId } });
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(await resolveSession(db, login.token, new Date(Date.now() + 11 * 60 * 1000))).toBeNull();
  });

  it("expires an idle session and honours sign-out-everywhere", async () => {
    const user = await makeUser("sessions");
    const a = await enrolledLogin(user.email);
    const b = await loginWithPassword(db, { email: user.email, password: PASSWORD, ...meta });
    const c = await loginWithPassword(db, { email: user.email, password: PASSWORD, ...meta });
    if (!b.ok || !c.ok) throw new Error("login failed");
    // Idle expiry: pretend the session was last seen 13 hours ago.
    await db.session.update({
      where: { id: c.sessionId },
      data: { lastSeenAt: new Date(Date.now() - SESSION_IDLE_MS - 60_000) },
    });
    expect(await resolveSession(db, c.token)).toBeNull();
    const revoked = await revokeAllSessions(db, user.id, "test", {
      userId: user.id,
      sessionId: a.actor.sessionId,
      ...meta,
    });
    expect(revoked).toBeGreaterThanOrEqual(2);
    expect(await resolveSession(db, a.token)).toBeNull();
    expect(await resolveSession(db, b.token)).toBeNull();
    expect(await resolveSession(db, "not-a-real-token-at-all-000000")).toBeNull();
  });
});

describe("roles and permissions", () => {
  it("gives Owner and Full everything, View-only two things, and Limited only what was ticked", () => {
    expect(effectivePermissions("OWNER").has("MANAGE_USERS")).toBe(true);
    expect(effectivePermissions("FULL").has("MANAGE_USERS")).toBe(true);
    expect([...effectivePermissions("VIEW_ONLY")].sort()).toEqual(["RUN_REPORTS", "VIEW_LEDGER"]);
    expect([...effectivePermissions("LIMITED", ["UPLOAD_RECEIPTS", "VIEW_LEDGER"])].sort()).toEqual(
      ["UPLOAD_RECEIPTS", "VIEW_LEDGER"],
    );
    expect(effectivePermissions("LIMITED", []).size).toBe(0);
  });

  it("denies on the server, not just in the UI", () => {
    expect(() => assertPermission({ role: "VIEW_ONLY", permissions: [] }, "EDIT_POSTED")).toThrow(
      ForbiddenError,
    );
    expect(() =>
      assertPermission({ role: "LIMITED", permissions: ["VIEW_LEDGER"] }, "MANAGE_USERS"),
    ).toThrow(ForbiddenError);
    expect(() =>
      assertPermission({ role: "LIMITED", permissions: ["MANAGE_USERS"] }, "MANAGE_USERS"),
    ).not.toThrow();
    expect(() => assertPermission({ role: "FULL", permissions: [] }, "EXPORT")).not.toThrow();
  });
});
