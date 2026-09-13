/**
 * DEVELOPMENT ONLY. Removes everything the historical import wrote (imported transactions with their
 * lines and notes, the archived reference models, the import runs) so the import can be run again from
 * scratch on a local database — for instance after the importer changed. Users, the chart, classes,
 * tax years, hand-entered rows and the audit log are kept. Refuses non-local databases unless
 * --i-know-this-destroys-data is given. Needs the owner connection (DATABASE_URL): the app role cannot
 * delete these rows, and the protecting triggers are switched off only for the duration of this script.
 *
 *   pnpm import:reset-dev
 */
import "dotenv/config";
import { createPrismaClient } from "../../src/lib/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const host = new URL(url).hostname;
if (
  !["localhost", "127.0.0.1", "::1"].includes(host) &&
  !process.argv.includes("--i-know-this-destroys-data")
) {
  console.error(
    `Refusing: ${host} is not a local database. This command deletes every imported row.`,
  );
  process.exit(1);
}

async function main() {
  const db = createPrismaClient(url as string);
  try {
    const before = await db.transaction.count({ where: { source: "IMPORT" } });
    await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`ALTER TABLE "transaction_lines" DISABLE TRIGGER USER`);
        await tx.$executeRawUnsafe(`ALTER TABLE "transactions" DISABLE TRIGGER USER`);
        await tx.$executeRawUnsafe(`ALTER TABLE "notes" DISABLE TRIGGER USER`);
        await tx.$executeRawUnsafe(`ALTER TABLE "allocation_model_versions" DISABLE TRIGGER USER`);
        await tx.$executeRawUnsafe(`ALTER TABLE "allocation_targets" DISABLE TRIGGER USER`);
        await tx.$executeRawUnsafe(
          `DELETE FROM "notes" WHERE "transaction_id" IN (SELECT "id" FROM "transactions" WHERE "source" = 'IMPORT')`,
        );
        await tx.$executeRawUnsafe(
          `DELETE FROM "transaction_lines" WHERE "transaction_id" IN (SELECT "id" FROM "transactions" WHERE "source" = 'IMPORT')`,
        );
        await tx.$executeRawUnsafe(`DELETE FROM "transactions" WHERE "source" = 'IMPORT'`);
        await tx.$executeRawUnsafe(
          `UPDATE "allocation_models" SET "current_version_id" = NULL, "applied_version_id" = NULL WHERE "is_reference"`,
        );
        await tx.$executeRawUnsafe(
          `DELETE FROM "allocation_targets" WHERE "version_id" IN (SELECT v."id" FROM "allocation_model_versions" v JOIN "allocation_models" m ON m."id" = v."model_id" WHERE m."is_reference")`,
        );
        await tx.$executeRawUnsafe(
          `DELETE FROM "allocation_model_versions" WHERE "model_id" IN (SELECT "id" FROM "allocation_models" WHERE "is_reference")`,
        );
        await tx.$executeRawUnsafe(`DELETE FROM "allocation_models" WHERE "is_reference"`);
        await tx.$executeRawUnsafe(`DELETE FROM "import_runs"`);
        await tx.$executeRawUnsafe(`ALTER TABLE "allocation_targets" ENABLE TRIGGER USER`);
        await tx.$executeRawUnsafe(`ALTER TABLE "allocation_model_versions" ENABLE TRIGGER USER`);
        await tx.$executeRawUnsafe(`ALTER TABLE "notes" ENABLE TRIGGER USER`);
        await tx.$executeRawUnsafe(`ALTER TABLE "transactions" ENABLE TRIGGER USER`);
        await tx.$executeRawUnsafe(`ALTER TABLE "transaction_lines" ENABLE TRIGGER USER`);
        await tx.auditLog.create({
          data: {
            action: "import.reset_dev",
            subjectType: "system",
            reason: "scripts/import/reset-dev.ts on a local development database",
            after: { importedTransactionsRemoved: before },
          },
        });
      },
      { timeout: 10 * 60_000 },
    );
    console.log(
      `Removed ${before.toLocaleString("en-US")} imported transactions, the reference models and the import runs. Run pnpm import:run to import again.`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
