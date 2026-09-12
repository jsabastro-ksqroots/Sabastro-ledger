/**
 * DEVELOPMENT ONLY. Drops and recreates the database named in DATABASE_URL, applies all migrations and
 * runs the seed. Everything in that database is lost. Refuses to run against anything that does not look
 * like a local database (host must be localhost / 127.0.0.1) unless --i-know-this-destroys-data is given.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const parsed = new URL(url);
const dbName = parsed.pathname.replace(/^\//, "");
const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
if (!local && !process.argv.includes("--i-know-this-destroys-data")) {
  console.error(
    `Refusing: ${parsed.hostname} is not a local database. This command destroys all data.`,
  );
  process.exit(1);
}

async function main() {
  const admin = new URL(url as string);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const safeName = dbName.replace(/[^a-zA-Z0-9_]/g, "");
  await client.query(`DROP DATABASE IF EXISTS "${safeName}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${safeName}"`);
  await client.end();
  console.log(`Database ${safeName} recreated. Applying migrations…`);
  const run = (cmd: string, args: string[]) => {
    const r = spawnSync(cmd, args, {
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    });
    if (r.status !== 0) process.exit(r.status ?? 1);
  };
  run("pnpm", ["exec", "prisma", "migrate", "deploy"]);
  run("pnpm", ["exec", "tsx", "prisma/seed.ts"]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
