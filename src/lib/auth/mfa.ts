import type { DbOrTx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { generateRecoveryCode, normalizeRecoveryCode } from "@/lib/crypto";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  checkTotp,
  decryptTotpSecret,
  encryptTotpSecret,
  newTotpSecret,
  totpQrDataUrl,
  totpUri,
} from "@/lib/auth/totp";
import { markSessionMfaVerified, revokeAllSessions, type RequestMeta } from "@/lib/auth/session";
import { clearFailures, registerFailure, secondsUntil } from "@/lib/auth/lockout";

export const RECOVERY_CODE_COUNT = 10;

export type MfaResult =
  | { ok: true; token: string; recoveryCodesRemaining?: number }
  | { ok: false; reason: "invalid" | "locked" | "not_enrolled"; retryAfterSeconds?: number };

type Actor = { userId: string; sessionId: string } & RequestMeta;

/** Step 2 of signing in: the 6-digit authenticator code. */
export async function verifyMfaCode(
  tx: DbOrTx,
  actor: Actor,
  code: string,
  now = new Date(),
): Promise<MfaResult> {
  const user = await tx.user.findUnique({ where: { id: actor.userId } });
  if (!user) return { ok: false, reason: "invalid" };
  if (!user.mfaEnrolledAt || !user.mfaSecretEnc) return { ok: false, reason: "not_enrolled" };
  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    return { ok: false, reason: "locked", retryAfterSeconds: secondsUntil(user.lockedUntil, now) };
  }
  const secret = decryptTotpSecret(user.mfaSecretEnc);
  const check = checkTotp(secret, code, user.mfaLastTimeStep, Math.floor(now.getTime() / 1000));
  if (!check.valid) {
    const { lockedUntil } = await registerFailure(tx, user, "mfa", actor, now);
    if (lockedUntil)
      return { ok: false, reason: "locked", retryAfterSeconds: secondsUntil(lockedUntil, now) };
    return { ok: false, reason: "invalid" };
  }
  await tx.user.update({
    where: { id: user.id },
    data: { mfaLastTimeStep: check.timeStep ?? user.mfaLastTimeStep },
  });
  await clearFailures(tx, user.id, now);
  const token = await markSessionMfaVerified(tx, actor.sessionId, now);
  await audit(tx, {
    action: "login.success",
    userId: user.id,
    sessionId: actor.sessionId,
    subjectType: "user",
    subjectId: user.id,
    subjectLabel: user.email,
    after: { method: "totp" },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return { ok: true, token };
}

/** Step 2 alternative: a one-time recovery code. */
export async function verifyRecoveryCode(
  tx: DbOrTx,
  actor: Actor,
  input: string,
  now = new Date(),
): Promise<MfaResult> {
  const user = await tx.user.findUnique({ where: { id: actor.userId } });
  if (!user) return { ok: false, reason: "invalid" };
  if (!user.mfaEnrolledAt) return { ok: false, reason: "not_enrolled" };
  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    return { ok: false, reason: "locked", retryAfterSeconds: secondsUntil(user.lockedUntil, now) };
  }
  const normalized = normalizeRecoveryCode(input);
  const codes = await tx.recoveryCode.findMany({ where: { userId: user.id, usedAt: null } });
  let matched: string | null = null;
  if (normalized.length === 10) {
    for (const c of codes) {
      if (await verifyPassword(c.codeHash, normalized)) {
        matched = c.id;
        break;
      }
    }
  }
  if (!matched) {
    const { lockedUntil } = await registerFailure(tx, user, "recovery", actor, now);
    if (lockedUntil)
      return { ok: false, reason: "locked", retryAfterSeconds: secondsUntil(lockedUntil, now) };
    return { ok: false, reason: "invalid" };
  }
  await tx.recoveryCode.update({ where: { id: matched }, data: { usedAt: now } });
  await clearFailures(tx, user.id, now);
  const token = await markSessionMfaVerified(tx, actor.sessionId, now);
  const remaining = codes.length - 1;
  await audit(tx, {
    action: "login.recovery_code_used",
    userId: user.id,
    sessionId: actor.sessionId,
    subjectType: "user",
    subjectId: user.id,
    subjectLabel: user.email,
    after: { method: "recovery_code", remaining },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return { ok: true, token, recoveryCodesRemaining: remaining };
}

/**
 * Returns the pending enrollment (so a page refresh shows the same QR code), starting one if needed.
 */
export async function ensureMfaEnrollment(
  tx: DbOrTx,
  actor: Actor,
): Promise<{ secret: string; uri: string; qrDataUrl: string }> {
  const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (user.mfaEnrolledAt) throw new Error("MFA is already enrolled; reset it first.");
  if (user.mfaSecretEnc) {
    const secret = decryptTotpSecret(user.mfaSecretEnc);
    const uri = totpUri(user.email, secret);
    return { secret, uri, qrDataUrl: await totpQrDataUrl(uri) };
  }
  return beginMfaEnrollment(tx, actor);
}

/** Starts (or restarts) enrollment: a fresh secret is stored encrypted but not yet active. */
export async function beginMfaEnrollment(
  tx: DbOrTx,
  actor: Actor,
): Promise<{ secret: string; uri: string; qrDataUrl: string }> {
  const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (user.mfaEnrolledAt) throw new Error("MFA is already enrolled; reset it first.");
  const secret = newTotpSecret();
  await tx.user.update({
    where: { id: user.id },
    data: { mfaSecretEnc: encryptTotpSecret(secret), mfaLastTimeStep: null },
  });
  await audit(tx, {
    action: "mfa.enrollment_started",
    userId: user.id,
    sessionId: actor.sessionId,
    subjectType: "user",
    subjectId: user.id,
    subjectLabel: user.email,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  const uri = totpUri(user.email, secret);
  return { secret, uri, qrDataUrl: await totpQrDataUrl(uri) };
}

async function issueRecoveryCodes(tx: DbOrTx, userId: string): Promise<string[]> {
  await tx.recoveryCode.deleteMany({ where: { userId } });
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) codes.push(generateRecoveryCode());
  const hashes = await Promise.all(codes.map((c) => hashPassword(normalizeRecoveryCode(c))));
  await tx.recoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId, codeHash })) });
  return codes;
}

/** Confirms enrollment with a code from the freshly scanned secret; returns the one-time recovery codes. */
export async function confirmMfaEnrollment(
  tx: DbOrTx,
  actor: Actor,
  code: string,
  now = new Date(),
): Promise<
  | { ok: true; token: string; recoveryCodes: string[] }
  | { ok: false; reason: "invalid" | "no_pending" }
> {
  const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (user.mfaEnrolledAt || !user.mfaSecretEnc) return { ok: false, reason: "no_pending" };
  const secret = decryptTotpSecret(user.mfaSecretEnc);
  const check = checkTotp(secret, code, null, Math.floor(now.getTime() / 1000));
  if (!check.valid) {
    await audit(tx, {
      action: "mfa.enrollment_failed",
      userId: user.id,
      sessionId: actor.sessionId,
      subjectType: "user",
      subjectId: user.id,
      subjectLabel: user.email,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { ok: false, reason: "invalid" };
  }
  await tx.user.update({
    where: { id: user.id },
    data: { mfaEnrolledAt: now, mfaLastTimeStep: check.timeStep },
  });
  const recoveryCodes = await issueRecoveryCodes(tx, user.id);
  await clearFailures(tx, user.id, now);
  const token = await markSessionMfaVerified(tx, actor.sessionId, now);
  await audit(tx, {
    action: "mfa.enrolled",
    userId: user.id,
    sessionId: actor.sessionId,
    subjectType: "user",
    subjectId: user.id,
    subjectLabel: user.email,
    after: { recoveryCodesIssued: recoveryCodes.length },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return { ok: true, token, recoveryCodes };
}

/** Replaces all recovery codes (shown once). */
export async function regenerateRecoveryCodes(tx: DbOrTx, actor: Actor): Promise<string[]> {
  const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!user.mfaEnrolledAt) throw new Error("Enrol MFA before generating recovery codes.");
  const codes = await issueRecoveryCodes(tx, user.id);
  await audit(tx, {
    action: "mfa.recovery_codes_regenerated",
    userId: user.id,
    sessionId: actor.sessionId,
    subjectType: "user",
    subjectId: user.id,
    subjectLabel: user.email,
    after: { issued: codes.length },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return codes;
}

/** An administrator resets someone's MFA (lost phone). Their sessions are ended and they must re-enrol. */
export async function resetMfa(
  tx: DbOrTx,
  actor: Actor & { role?: string },
  targetUserId: string,
  reason: string,
): Promise<void> {
  if (targetUserId === actor.userId)
    throw new Error(
      "You cannot reset your own MFA from the admin path; ask another administrator.",
    );
  const target = await tx.user.findUniqueOrThrow({ where: { id: targetUserId } });
  if (target.role === "OWNER" && actor.role !== "OWNER")
    throw new Error("Only the Owner's own recovery codes can reset the Owner's MFA.");
  await tx.user.update({
    where: { id: target.id },
    data: { mfaSecretEnc: null, mfaEnrolledAt: null, mfaLastTimeStep: null },
  });
  await tx.recoveryCode.deleteMany({ where: { userId: target.id } });
  await revokeAllSessions(tx, target.id, "MFA reset by administrator", actor);
  await audit(tx, {
    action: "mfa.reset",
    userId: actor.userId,
    sessionId: actor.sessionId,
    subjectType: "user",
    subjectId: target.id,
    subjectLabel: target.email,
    reason,
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
}
