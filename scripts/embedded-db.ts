/**
 * Runs a local PostgreSQL 16 without Docker, using the `embedded-postgres` package.
 *
 *   pnpm db:embedded            start it and keep it running (prints the connection URL)
 *   pnpm setup:nodocker         start, apply migrations, seed, stop
 *   pnpm dev:nodocker           start, migrate, seed, then run `next dev`; stops when you press Ctrl+C
 *
 * Data lives in .pg/dev (git-ignored) and survives restarts.
 */
import "dotenv/config";
import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import path from "node:path";

const PORT = Number(process.env.EMBEDDED_PG_PORT ?? 5433);
const DB = "sabastro_ledger";
const USER = "postgres";
const PASSWORD = "postgres";
const DATA_DIR = path.join(process.cwd(), ".pg", "dev");

const mode = process.argv.includes("--setup")
  ? "setup"
  : process.argv.includes("--dev")
    ? "dev"
    : "serve";

const ownerUrl = `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DB}`;
const appPassword = process.env.APP_DB_PASSWORD || "change-me-ledger-app";
const appUrl = `postgresql://ledger_app:${encodeURIComponent(appPassword)}@localhost:${PORT}/${DB}`;

function run(cmd: string, args: string[], extraEnv: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    onLog: () => {},
    onError: (msg: unknown) => console.error(String(msg)),
  });

  let initialised = false;
  try {
    await pg.initialise();
    initialised = true;
  } catch {
    // already initialised
  }
  await pg.start();
  if (initialised) {
    await pg.createDatabase(DB);
  } else {
    try {
      await pg.createDatabase(DB);
    } catch {
      // exists
    }
  }

  const envForChildren = {
    DATABASE_URL: ownerUrl,
    APP_DATABASE_URL: process.env.APP_DATABASE_URL?.includes(`:${PORT}/`)
      ? process.env.APP_DATABASE_URL
      : appUrl,
    APP_DB_PASSWORD: appPassword,
  };

  const stop = async () => {
    try {
      await pg.stop();
    } catch {
      /* ignore */
    }
  };

  console.log(`\nEmbedded Postgres 16 running on port ${PORT}`);
  console.log(`DATABASE_URL=${ownerUrl}`);

  if (mode === "serve") {
    console.log("Press Ctrl+C to stop.\n");
    process.on("SIGINT", async () => {
      await stop();
      process.exit(0);
    });
    process.on("SIGTERM", async () => {
      await stop();
      process.exit(0);
    });
    await new Promise(() => {});
    return;
  }

  let code = await run("pnpm", ["exec", "prisma", "migrate", "deploy"], envForChildren);
  if (code === 0) code = await run("pnpm", ["exec", "tsx", "prisma/seed.ts"], envForChildren);
  if (code !== 0) {
    await stop();
    process.exit(code);
  }
  if (mode === "setup") {
    await stop();
    console.log("\nSetup complete. Start the app with:  pnpm dev:nodocker");
    return;
  }
  const shutdown = async () => {
    await stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  code = await run("pnpm", ["exec", "next", "dev"], envForChildren);
  await stop();
  process.exit(code);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
