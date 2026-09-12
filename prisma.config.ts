import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations and the seed run with the OWNER connection (DATABASE_URL).
// The app itself connects as the restricted role `ledger_app` (APP_DATABASE_URL) — see src/lib/db.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url:
      process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/sabastro_ledger",
  },
});
