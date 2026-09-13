/**
 * Runs a local PostgreSQL 16 without Docker, using the `embedded-postgres` package.
 *
 *   pnpm db:embedded            start it and keep it running (prints the connection URL)
 *   pnpm setup:nodocker         start, apply migrations, seed, stop
 *   pnpm dev:nodocker           start, migrate, seed, then run `next dev`; stops when you press Ctrl+C
 *
 * Data lives in .pg/dev (git-ignored) and survives restarts. If a Postgres is already answering on the
 * port (a previous `pnpm db:embedded` left running, or the app started from the desktop app's preview), it
 * is reused instead of starting a second one, and it is left running afterwards.
 *
 * The app itself listens on port 3005 (http://localhost:3005): on Jamin's Mac another program has been
 * holding port 3000 for weeks, and Next would otherwise sit behind it invisibly.
 */
import "dotenv/config";
import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import pg from "pg";

const PORT = Number(process.env.EMBEDDED_PG_PORT ?? 5433);
const APP_PORT = process.env.APP_PORT ?? "3005";
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

/** True when something already accepts TCP connections on the port (a running Postgres). */
function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function ensureDatabaseExists(): Promise<void> {
  const client = new pg.Client({
    connectionString: `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/postgres`,
  });
  await client.connect();
  try {
    const r = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB]);
    if (r.rowCount === 0) await client.query(`CREATE DATABASE "${DB}"`);
  } finally {
    await client.end();
  }
}

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

  const reusing = await portInUse(PORT);
  if (reusing) {
    console.log(
      `A Postgres is already running on port ${PORT}; using it (it stays up when this stops).`,
    );
    await ensureDatabaseExists();
  } else {
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
  }

  const envForChildren = {
    DATABASE_URL: ownerUrl,
    APP_DATABASE_URL: process.env.APP_DATABASE_URL?.includes(`:${PORT}/`)
      ? process.env.APP_DATABASE_URL
      : appUrl,
    APP_DB_PASSWORD: appPassword,
  };

  const stop = async () => {
    if (reusing) return;
    try {
      await pg.stop();
    } catch {
      /* ignore */
    }
  };

  console.log(`\nEmbedded Postgres 16 ${reusing ? "reused" : "running"} on port ${PORT}`);
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
  console.log(
    `\nStarting the app on http://localhost:${APP_PORT} (if that port is busy, Next picks the next free one and says so).\n`,
  );
  code = await run("pnpm", ["exec", "next", "dev", "-p", APP_PORT], envForChildren);
  await stop();
  process.exit(code);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
