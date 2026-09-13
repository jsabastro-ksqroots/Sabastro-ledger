-- Phase 2: import runs + allocation models (reference models). See docs/DESIGN.md §1 and §5.

-- CreateEnum
CREATE TYPE "ImportRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AllocationBasis" AS ENUM ('PERCENT', 'VALUE', 'ACRES', 'MONTHS', 'COUNT');

-- CreateTable
CREATE TABLE "import_runs" (
    "id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "status" "ImportRunStatus" NOT NULL DEFAULT 'RUNNING',
    "dry_run" BOOLEAN NOT NULL DEFAULT false,
    "trigger" TEXT NOT NULL,
    "run_by_id" UUID,
    "sources" JSONB NOT NULL,
    "summary" JSONB,
    "all_checks_passed" BOOLEAN,
    "report_markdown" TEXT,
    "error" TEXT,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_models" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "tax_year_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_reference" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source_key" TEXT,
    "current_version_id" UUID,
    "applied_version_id" UUID,
    "applied_at" TIMESTAMPTZ(6),
    "applied_by_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "allocation_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_model_versions" (
    "id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "basis" "AllocationBasis" NOT NULL,
    "secondary_basis" "AllocationBasis",
    "note" TEXT,
    "diff" JSONB,
    "parameters" JSONB,
    "reverted_from_version_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_targets" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "class_id" UUID,
    "is_personal" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT NOT NULL,
    "weight" DECIMAL(18,6) NOT NULL,
    "weight_2" DECIMAL(18,6),
    "share_bp" INTEGER NOT NULL,
    "is_remainder_target" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "allocation_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_runs_started_at_idx" ON "import_runs"("started_at");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_models_source_key_key" ON "allocation_models"("source_key");

-- CreateIndex
CREATE INDEX "allocation_models_entity_id_idx" ON "allocation_models"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_models_tax_year_id_name_key" ON "allocation_models"("tax_year_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_model_versions_model_id_version_no_key" ON "allocation_model_versions"("model_id", "version_no");

-- CreateIndex
CREATE INDEX "allocation_targets_version_id_idx" ON "allocation_targets"("version_id");

-- CreateIndex
CREATE INDEX "allocation_targets_class_id_idx" ON "allocation_targets"("class_id");

-- AddForeignKey
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_allocation_model_version_id_fkey" FOREIGN KEY ("allocation_model_version_id") REFERENCES "allocation_model_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_allocation_target_id_fkey" FOREIGN KEY ("allocation_target_id") REFERENCES "allocation_targets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_models" ADD CONSTRAINT "allocation_models_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_models" ADD CONSTRAINT "allocation_models_tax_year_id_fkey" FOREIGN KEY ("tax_year_id") REFERENCES "tax_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_model_versions" ADD CONSTRAINT "allocation_model_versions_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "allocation_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_targets" ADD CONSTRAINT "allocation_targets_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "allocation_model_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_targets" ADD CONSTRAINT "allocation_targets_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written additions (docs/DESIGN.md §1 "Allocation models", §5; DECISIONS P2-*)
-- ===========================================================================

-- 1. Grants: import runs and allocation history are never deleted by the app role.
REVOKE DELETE, TRUNCATE ON "import_runs" FROM ledger_app;
REVOKE DELETE, TRUNCATE ON "allocation_models" FROM ledger_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "allocation_model_versions" FROM ledger_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "allocation_targets" FROM ledger_app;

-- 2. Checks.
ALTER TABLE "allocation_targets" ADD CONSTRAINT "allocation_targets_share_range"
  CHECK ("share_bp" >= 0 AND "share_bp" <= 10000);
ALTER TABLE "allocation_targets" ADD CONSTRAINT "allocation_targets_weights_non_negative"
  CHECK ("weight" >= 0 AND ("weight_2" IS NULL OR "weight_2" >= 0));
-- The Personal target is the one with no class; every other target names a class.
ALTER TABLE "allocation_targets" ADD CONSTRAINT "allocation_targets_personal_has_no_class"
  CHECK (("is_personal" AND "class_id" IS NULL) OR (NOT "is_personal" AND "class_id" IS NOT NULL));
ALTER TABLE "allocation_model_versions" ADD CONSTRAINT "allocation_model_versions_no_positive"
  CHECK ("version_no" > 0);
ALTER TABLE "allocation_model_versions" ADD CONSTRAINT "allocation_model_versions_bases_differ"
  CHECK ("secondary_basis" IS NULL OR "secondary_basis" <> "basis");

-- 3. A model belongs to the entity of its tax year.
CREATE OR REPLACE FUNCTION allocation_models_check_tax_year() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ty_entity uuid;
BEGIN
  SELECT "entity_id" INTO ty_entity FROM "tax_years" WHERE "id" = NEW."tax_year_id";
  IF ty_entity IS DISTINCT FROM NEW."entity_id" THEN
    RAISE EXCEPTION 'An allocation model belongs to the entity of its tax year' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER allocation_models_tax_year
  BEFORE INSERT OR UPDATE OF "entity_id", "tax_year_id" ON "allocation_models"
  FOR EACH ROW EXECUTE FUNCTION allocation_models_check_tax_year();

-- 4. Versions and targets are immutable once written (DESIGN §5): a change is always a new version.
CREATE OR REPLACE FUNCTION allocation_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Allocation model versions and their targets are immutable (% on % is not allowed); save a new version instead', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END $$;

CREATE TRIGGER allocation_model_versions_immutable
  BEFORE UPDATE OR DELETE ON "allocation_model_versions"
  FOR EACH ROW EXECUTE FUNCTION allocation_history_immutable();

CREATE TRIGGER allocation_targets_immutable
  BEFORE UPDATE OR DELETE ON "allocation_targets"
  FOR EACH ROW EXECUTE FUNCTION allocation_history_immutable();

-- 5. Per version: shares total exactly 100.00 % (10,000 basis points) and exactly one target takes the
--    rounding remainder. Checked at COMMIT so a version and its targets can be inserted in any order.
CREATE OR REPLACE FUNCTION allocation_versions_check_shares(p_version_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE total int; remainders int; n int;
BEGIN
  SELECT coalesce(sum("share_bp"), 0), count(*) FILTER (WHERE "is_remainder_target"), count(*)
    INTO total, remainders, n
    FROM "allocation_targets" WHERE "version_id" = p_version_id;
  IF n = 0 THEN RETURN; END IF;
  IF total <> 10000 THEN
    RAISE EXCEPTION 'Allocation version % shares total % basis points, not 10,000', p_version_id, total USING ERRCODE = 'check_violation';
  END IF;
  IF remainders <> 1 THEN
    RAISE EXCEPTION 'Allocation version % must have exactly one remainder target (it has %)', p_version_id, remainders USING ERRCODE = 'check_violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION allocation_targets_shares_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM allocation_versions_check_shares(NEW."version_id");
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER allocation_targets_shares
  AFTER INSERT ON "allocation_targets"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION allocation_targets_shares_trigger();

-- 6. A line linked to a model version must be dated inside that version's tax year (DESIGN §5).
CREATE OR REPLACE FUNCTION transaction_lines_check_model_year() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE yr int; model_year int;
BEGIN
  IF NEW."allocation_model_version_id" IS NULL THEN RETURN NEW; END IF;
  SELECT extract(year FROM t."date")::int INTO yr FROM "transactions" t WHERE t."id" = NEW."transaction_id";
  SELECT ty."year" INTO model_year
    FROM "allocation_model_versions" v
    JOIN "allocation_models" m ON m."id" = v."model_id"
    JOIN "tax_years" ty ON ty."id" = m."tax_year_id"
    WHERE v."id" = NEW."allocation_model_version_id";
  IF yr IS DISTINCT FROM model_year THEN
    RAISE EXCEPTION 'A line can only be linked to an allocation model of its own tax year (% vs %)', yr, model_year USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER transaction_lines_model_year
  BEFORE INSERT OR UPDATE OF "allocation_model_version_id" ON "transaction_lines"
  FOR EACH ROW EXECUTE FUNCTION transaction_lines_check_model_year();
