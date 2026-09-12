"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { loginWithPassword } from "@/lib/auth/login";
import { confirmMfaEnrollment, verifyMfaCode, verifyRecoveryCode } from "@/lib/auth/mfa";
import { revokeAllSessions, revokeSession } from "@/lib/auth/session";
import {
  clearSessionCookie,
  getCurrentSession,
  requestMeta,
  requireHalfSession,
  requireUser,
  setSessionCookie,
} from "@/lib/auth/current-user";

/** Only allow same-site relative paths as a post-login destination. */
export async function safeNext(next: string | undefined | null): Promise<string> {
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.startsWith("/login") ||
    next.startsWith("/mfa")
  )
    return "/dashboard";
  return next.slice(0, 200);
}

export type LoginState = { error?: string; retryAfterSeconds?: number };

const loginSchema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(500),
  next: z.string().optional(),
});

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter your email and password." };
  const meta = await requestMeta();
  const result = await loginWithPassword(db, {
    email: parsed.data.email,
    password: parsed.data.password,
    ...meta,
  });
  if (!result.ok) {
    switch (result.reason) {
      case "locked":
        return {
          error: `Too many failed attempts. This account is locked for about ${Math.ceil((result.retryAfterSeconds ?? 900) / 60)} minutes.`,
          retryAfterSeconds: result.retryAfterSeconds,
        };
      case "throttled":
        return {
          error: "Too many attempts from this network. Please wait 15 minutes and try again.",
        };
      case "inactive":
        return { error: "This account has been deactivated. Ask the Owner to reactivate it." };
      default:
        return { error: "That email and password combination is not right." };
    }
  }
  await setSessionCookie(result.token);
  const next = await safeNext(parsed.data.next);
  redirect(result.needsEnrollment ? "/mfa/enroll" : `/mfa/verify?next=${encodeURIComponent(next)}`);
}

export type MfaState = { error?: string; recoveryCodesRemaining?: number };

const mfaSchema = z.object({
  code: z.string().trim().max(40).optional(),
  recovery: z.string().trim().max(40).optional(),
  next: z.string().optional(),
});

export async function verifyMfaAction(_prev: MfaState, formData: FormData): Promise<MfaState> {
  const user = await requireHalfSession();
  const parsed = mfaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter the 6-digit code from your authenticator app." };
  const meta = await requestMeta();
  const actor = { userId: user.id, sessionId: user.sessionId, ...meta };
  const useRecovery = !!parsed.data.recovery;
  const result = useRecovery
    ? await verifyRecoveryCode(db, actor, parsed.data.recovery ?? "")
    : await verifyMfaCode(db, actor, parsed.data.code ?? "");
  if (!result.ok) {
    if (result.reason === "not_enrolled") redirect("/mfa/enroll");
    if (result.reason === "locked")
      return {
        error: `Too many wrong codes. Locked for about ${Math.ceil((result.retryAfterSeconds ?? 900) / 60)} minutes.`,
      };
    return {
      error: useRecovery
        ? "That recovery code is not valid (or was already used)."
        : "That code is not right. Codes change every 30 seconds — try the newest one.",
    };
  }
  await setSessionCookie(result.token);
  const next = await safeNext(parsed.data.next);
  if (useRecovery && (result.recoveryCodesRemaining ?? 10) <= 2) {
    redirect(
      `${next}${next.includes("?") ? "&" : "?"}recovery_left=${result.recoveryCodesRemaining ?? 0}`,
    );
  }
  redirect(next);
}

export type EnrollState = { error?: string; recoveryCodes?: string[] };

export async function confirmEnrollmentAction(
  _prev: EnrollState,
  formData: FormData,
): Promise<EnrollState> {
  const user = await requireHalfSession();
  const code = String(formData.get("code") ?? "").trim();
  const meta = await requestMeta();
  const result = await confirmMfaEnrollment(
    db,
    { userId: user.id, sessionId: user.sessionId, ...meta },
    code,
  );
  if (!result.ok) {
    if (result.reason === "no_pending") redirect("/mfa/verify");
    return {
      error:
        "That code did not match. Make sure you scanned the newest QR code and try the current 6-digit code.",
    };
  }
  await setSessionCookie(result.token);
  return { recoveryCodes: result.recoveryCodes };
}

export async function signOutAction(): Promise<void> {
  const resolved = await getCurrentSession();
  if (resolved) {
    const meta = await requestMeta();
    await revokeSession(db, resolved.session.id, "signed out", {
      userId: resolved.user.id,
      ...meta,
    });
  }
  await clearSessionCookie();
  redirect("/login");
}

export async function signOutEverywhereAction(): Promise<void> {
  const user = await requireUser();
  const meta = await requestMeta();
  await revokeAllSessions(db, user.id, "sign out everywhere", {
    userId: user.id,
    sessionId: user.sessionId,
    ...meta,
  });
  await clearSessionCookie();
  redirect("/login?signed_out=everywhere");
}
