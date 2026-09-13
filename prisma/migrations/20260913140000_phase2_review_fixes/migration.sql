-- Phase 2 follow-up (review of the import commit): tighter rules around allocation models and the lines
-- that may reference them. Additive only; nothing is dropped. See docs/DECISIONS.md P2-22.

-- 1. A model's current / applied version must be one of its own versions.
ALTER TABLE "allocation_models" ADD CONSTRAINT "allocation_models_current_version_id_fkey"
  FOREIGN KEY ("current_version_id") REFERENCES "allocation_model_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "allocation_models" ADD CONSTRAINT "allocation_models_applied_version_id_fkey"
  FOREIGN KEY ("applied_version_id") REFERENCES "allocation_model_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION allocation_models_check_versions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_model uuid;
BEGIN
  IF NEW."current_version_id" IS NOT NULL THEN
    SELECT "model_id" INTO owner_model FROM "allocation_model_versions" WHERE "id" = NEW."current_version_id";
    IF owner_model IS DISTINCT FROM NEW."id" THEN
      RAISE EXCEPTION 'The current version of an allocation model must be one of its own versions' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."applied_version_id" IS NOT NULL THEN
    SELECT "model_id" INTO owner_model FROM "allocation_model_versions" WHERE "id" = NEW."applied_version_id";
    IF owner_model IS DISTINCT FROM NEW."id" THEN
      RAISE EXCEPTION 'The applied version of an allocation model must be one of its own versions' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER allocation_models_versions
  BEFORE INSERT OR UPDATE OF "current_version_id", "applied_version_id" ON "allocation_models"
  FOR EACH ROW EXECUTE FUNCTION allocation_models_check_versions();

-- 2. A target's class belongs to the model's entity (or is the shared General class).
CREATE OR REPLACE FUNCTION allocation_targets_check_class_entity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cls record; model_entity uuid;
BEGIN
  IF NEW."class_id" IS NULL THEN RETURN NEW; END IF;
  SELECT "entity_id", "is_shared" INTO cls FROM "classes" WHERE "id" = NEW."class_id";
  SELECT m."entity_id" INTO model_entity
    FROM "allocation_model_versions" v JOIN "allocation_models" m ON m."id" = v."model_id"
    WHERE v."id" = NEW."version_id";
  IF NOT cls."is_shared" AND cls."entity_id" IS DISTINCT FROM model_entity THEN
    RAISE EXCEPTION 'An allocation target must be a class of the model''s own entity' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER allocation_targets_class_entity
  BEFORE INSERT ON "allocation_targets"
  FOR EACH ROW EXECUTE FUNCTION allocation_targets_check_class_entity();

-- 3. A line linked to a model: same tax year AND same entity (bridge lines excepted), the target belongs
--    to that version, both ids or neither, and never an archived reference model (they are documentation).
CREATE OR REPLACE FUNCTION transaction_lines_check_model_year() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE yr int; model_year int; model_entity uuid; is_ref boolean; target_version uuid;
BEGIN
  IF (NEW."allocation_model_version_id" IS NULL) <> (NEW."allocation_target_id" IS NULL) THEN
    RAISE EXCEPTION 'A line links to an allocation model version and target together, or to neither' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."allocation_model_version_id" IS NULL THEN RETURN NEW; END IF;
  SELECT extract(year FROM t."date")::int INTO yr FROM "transactions" t WHERE t."id" = NEW."transaction_id";
  SELECT ty."year", m."entity_id", m."is_reference" INTO model_year, model_entity, is_ref
    FROM "allocation_model_versions" v
    JOIN "allocation_models" m ON m."id" = v."model_id"
    JOIN "tax_years" ty ON ty."id" = m."tax_year_id"
    WHERE v."id" = NEW."allocation_model_version_id";
  IF is_ref THEN
    RAISE EXCEPTION 'Archived reference models are documentation only and are never applied to lines' USING ERRCODE = 'check_violation';
  END IF;
  IF yr IS DISTINCT FROM model_year THEN
    RAISE EXCEPTION 'A line can only be linked to an allocation model of its own tax year (% vs %)', yr, model_year USING ERRCODE = 'check_violation';
  END IF;
  IF NOT NEW."is_bridge" AND NEW."entity_id" IS DISTINCT FROM model_entity THEN
    RAISE EXCEPTION 'A line can only be linked to an allocation model of its own entity' USING ERRCODE = 'check_violation';
  END IF;
  SELECT "version_id" INTO target_version FROM "allocation_targets" WHERE "id" = NEW."allocation_target_id";
  IF target_version IS DISTINCT FROM NEW."allocation_model_version_id" THEN
    RAISE EXCEPTION 'The allocation target of a line must belong to the version the line is linked to' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "transaction_lines_model_year" ON "transaction_lines";
CREATE TRIGGER transaction_lines_model_year
  BEFORE INSERT OR UPDATE OF "allocation_model_version_id", "allocation_target_id", "entity_id" ON "transaction_lines"
  FOR EACH ROW EXECUTE FUNCTION transaction_lines_check_model_year();

-- 4. A date change on the transaction cannot move model-linked live lines out of their model's tax year.
CREATE OR REPLACE FUNCTION transactions_check_model_year_on_date() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bad record;
BEGIN
  IF extract(year FROM NEW."date") = extract(year FROM OLD."date") THEN RETURN NEW; END IF;
  SELECT ty."year" AS model_year INTO bad
    FROM "transaction_lines" l
    JOIN "allocation_model_versions" v ON v."id" = l."allocation_model_version_id"
    JOIN "allocation_models" m ON m."id" = v."model_id"
    JOIN "tax_years" ty ON ty."id" = m."tax_year_id"
    WHERE l."transaction_id" = NEW."id" AND l."superseded_at" IS NULL
      AND ty."year" <> extract(year FROM NEW."date")::int
    LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Transaction #% has lines split by a % allocation model; change the split before moving it to another year', NEW."seq", bad.model_year USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER transactions_model_year_on_date
  BEFORE UPDATE OF "date" ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION transactions_check_model_year_on_date();
