import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runSeed } from "../src/lib/seed/run-seed";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const summary = await runSeed(prisma, { log: (l) => console.log(l) });
    console.log("Seed complete:");
    for (const [k, v] of Object.entries(summary)) {
      console.log(
        `  ${k}: ${typeof v === "object" ? `${v.created} created, ${v.existing} already present` : v}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
