import { generateSecret, generateSync, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { env } from "@/lib/env";

/** Accept codes up to 30 seconds either side of now (one step), the common authenticator default. */
const EPOCH_TOLERANCE_SECONDS = 30;

export function newTotpSecret(): string {
  return generateSecret();
}

export function totpUri(accountLabel: string, secret: string): string {
  return generateURI({ issuer: env().TOTP_ISSUER, label: accountLabel, secret });
}

export async function totpQrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, { width: 224, margin: 1, errorCorrectionLevel: "M" });
}

export interface TotpCheck {
  valid: boolean;
  /** The RFC 6238 time step the code belongs to; stored to block replay of the same code. */
  timeStep: number | null;
}

/**
 * Verifies a 6-digit code. `afterTimeStep` (the last accepted step) rejects a code that was already used.
 */
export function checkTotp(
  secret: string,
  code: string,
  afterTimeStep?: number | null,
  epoch?: number,
): TotpCheck {
  const token = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(token)) return { valid: false, timeStep: null };
  try {
    const result = verifySync({
      secret,
      token,
      epochTolerance: EPOCH_TOLERANCE_SECONDS,
      ...(afterTimeStep !== undefined && afterTimeStep !== null ? { afterTimeStep } : {}),
      ...(epoch !== undefined ? { epoch } : {}),
    });
    const timeStep = (result as { timeStep?: number }).timeStep ?? null;
    return { valid: result.valid, timeStep };
  } catch {
    return { valid: false, timeStep: null };
  }
}

/** For tests and for the CLI: the code that is valid right now. */
export function currentTotpCode(secret: string, epoch?: number): string {
  return generateSync({ secret, ...(epoch !== undefined ? { epoch } : {}) });
}

export function encryptTotpSecret(secret: string): string {
  return encryptSecret(secret, env().TOTP_ENCRYPTION_KEY);
}

export function decryptTotpSecret(encrypted: string): string {
  return decryptSecret(encrypted, env().TOTP_ENCRYPTION_KEY);
}
