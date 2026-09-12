import { z } from "zod";

/**
 * Server-side environment. Parsed once, lazily, so importing this module never throws at build time.
 * Never import this from a client component.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  APP_DATABASE_URL: z.string().min(1).optional(),
  TOTP_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "TOTP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)"),
  TOTP_ISSUER: z.string().min(1).default("Sabastro Ledger"),
  SEED_OWNER_EMAIL: z.string().email().optional(),
  SEED_OWNER_NAME: z.string().optional(),
  SEED_OWNER_PASSWORD: z.string().optional(),
  SEED_FULL_EMAIL: z.string().email().optional(),
  SEED_FULL_NAME: z.string().optional(),
  SEED_FULL_PASSWORD: z.string().optional(),
  APP_DB_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Environment is not configured correctly: ${issues}. See .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forget the cached environment so a test can change it. */
export function resetEnvCache(): void {
  cached = null;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
