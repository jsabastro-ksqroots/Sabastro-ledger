import { inject } from "vitest";

// Runs in every worker before the test file is imported, so `env()` and the database client see the test database.
Object.assign(process.env, { NODE_ENV: "test" });
process.env.DATABASE_URL = inject("databaseUrl");
process.env.APP_DATABASE_URL = inject("appDatabaseUrl");
process.env.TOTP_ENCRYPTION_KEY =
  process.env.TOTP_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.TOTP_ISSUER = "Sabastro Ledger Test";
process.env.APP_URL = "http://localhost:3000";
