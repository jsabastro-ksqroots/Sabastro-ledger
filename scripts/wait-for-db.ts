/** Waits (up to 60 s) until the database in DATABASE_URL accepts connections. */
import "dotenv/config";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const deadline = Date.now() + 60_000;
async function attempt(): Promise<boolean> {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

(async () => {
  while (Date.now() < deadline) {
    if (await attempt()) {
      console.log("Database is ready.");
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.error("Timed out waiting for the database. Is Docker Desktop running? Try: pnpm db:up");
  process.exit(1);
})();
