import { hash, verify, type Options } from "@node-rs/argon2";

// OWASP-recommended Argon2id parameters (64 MiB, 3 passes). Algorithm 2 = Argon2id in @node-rs/argon2's
// `Algorithm` enum (a const enum, which cannot be imported under isolatedModules).
const OPTIONS: Options = { algorithm: 2, memoryCost: 65536, timeCost: 3, parallelism: 1 };

export const PASSWORD_MIN_LENGTH = 12;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, OPTIONS);
  } catch {
    return false;
  }
}

/** A pre-computed hash used to keep timing constant when the email does not exist. */
let dummyHashPromise: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword("dummy-password-for-timing-equalisation");
  return dummyHashPromise;
}

export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH)
    problems.push(`at least ${PASSWORD_MIN_LENGTH} characters`);
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password))
    problems.push("both upper- and lower-case letters");
  if (!/\d/.test(password)) problems.push("at least one number");
  return problems;
}
