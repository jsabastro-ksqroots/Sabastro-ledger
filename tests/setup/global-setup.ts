/**
 * Vitest global setup: provides a migrated PostgreSQL database to every test file.
 *  - If TEST_DATABASE_URL is set (e.g. a Docker database), it is used as-is (and migrated).
 *  - Otherwise an embedded PostgreSQL 16 is started on a free port with a throw-away data directory.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    appDatabaseUrl: string;
  }
}

const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const APP_PASSWORD = "test-ledger-app";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export default async function globalSetup(project: TestProject) {
  let ownerUrl = process.env.TEST_DATABASE_URL;
  let embedded: { stop(): Promise<void> } | null = null;
  let dataDir: string | null = null;

  if (!ownerUrl) {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const port = await freePort();
    dataDir = mkdtempSync(path.join(os.tmpdir(), "sabastro-ledger-test-pg-"));
    const instance = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "postgres",
      password: "postgres",
      port,
      persistent: false,
      onLog: () => {},
      onError: () => {},
    });
    await instance.initialise();
    await instance.start();
    await instance.createDatabase("sabastro_ledger_test");
    embedded = instance;
    ownerUrl = `postgresql://postgres:postgres@localhost:${port}/sabastro_ledger_test`;
  }

  execSync("pnpm exec prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: ownerUrl },
  });

  // Make the restricted app role reachable with a known password.
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  await client.query(`ALTER ROLE ledger_app WITH LOGIN PASSWORD '${APP_PASSWORD}'`);
  await client.end();

  const u = new URL(ownerUrl);
  u.username = "ledger_app";
  u.password = APP_PASSWORD;
  const appUrl = u.toString();

  project.provide("databaseUrl", ownerUrl);
  project.provide("appDatabaseUrl", appUrl);
  process.env.DATABASE_URL = ownerUrl;
  process.env.APP_DATABASE_URL = appUrl;
  process.env.TOTP_ENCRYPTION_KEY = process.env.TOTP_ENCRYPTION_KEY || TEST_KEY;

  return async () => {
    if (embedded) await embedded.stop();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  };
}
