import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Database client. The app connects as the restricted role `ledger_app` (APP_DATABASE_URL) whenever it is
 * configured, and falls back to the owner connection (DATABASE_URL) with a warning otherwise.
 * Created lazily so that importing this module at build time never needs a database.
 */
export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;
export type DbOrTx = Db | Tx;

const globalForPrisma = globalThis as unknown as {
  __sabastroPrisma?: PrismaClient;
  __sabastroWarned?: boolean;
};

export function runtimeDatabaseUrl(): string {
  const app = process.env.APP_DATABASE_URL;
  if (app) return app;
  const owner = process.env.DATABASE_URL;
  if (!owner) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  if (!globalForPrisma.__sabastroWarned) {
    globalForPrisma.__sabastroWarned = true;
    console.warn(
      "[db] APP_DATABASE_URL is not set — the app is using the owner connection. Set it so the app runs as the restricted role `ledger_app`.",
    );
  }
  return owner;
}

export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export function getDb(): PrismaClient {
  if (!globalForPrisma.__sabastroPrisma) {
    globalForPrisma.__sabastroPrisma = createPrismaClient(runtimeDatabaseUrl());
  }
  return globalForPrisma.__sabastroPrisma;
}

/** Lazy proxy so `db.user.findMany()` works without calling getDb() first. */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getDb();
    const value = Reflect.get(client, prop) as unknown;
    return typeof value === "function"
      ? (value as (...a: unknown[]) => unknown).bind(client)
      : value;
  },
});

/** Test helper: drop the cached client (e.g. after changing connection strings). */
export async function disconnectDb(): Promise<void> {
  if (globalForPrisma.__sabastroPrisma) {
    await globalForPrisma.__sabastroPrisma.$disconnect();
    globalForPrisma.__sabastroPrisma = undefined;
  }
}
