-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('DRAFT', 'FLAGGED', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('BANK', 'JOURNAL', 'ADJUSTING');

-- CreateEnum
CREATE TYPE "TransactionSource" AS ENUM ('IMPORT', 'RECEIPT', 'STATEMENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "ClassificationSource" AS ENUM ('IMPORT', 'VENDOR_HISTORY', 'AI', 'HUMAN');

-- CreateEnum
CREATE TYPE "NoteKind" AS ENUM ('SYSTEM', 'USER');

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "entity_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "vendor" TEXT,
    "memo" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'DRAFT',
    "kind" "TransactionKind" NOT NULL DEFAULT 'BANK',
    "bank_account_id" UUID,
    "source" "TransactionSource" NOT NULL DEFAULT 'MANUAL',
    "source_file" TEXT,
    "source_ref" TEXT,
    "source_ref_2" TEXT,
    "filled_in_by" TEXT,
    "verified_by_owner" BOOLEAN NOT NULL DEFAULT false,
    "classification_source" "ClassificationSource",
    "ai_confidence" DECIMAL(4,3),
    "flags" JSONB NOT NULL DEFAULT '[]',
    "needs_model_split" BOOLEAN NOT NULL DEFAULT false,
    "receipt_expected_count" INTEGER NOT NULL DEFAULT 0,
    "posted_at" TIMESTAMPTZ(6),
    "posted_by_id" UUID,
    "voided_at" TIMESTAMPTZ(6),
    "voided_by_id" UUID,
    "void_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_lines" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "account_id" UUID,
    "class_id" UUID,
    "entity_id" UUID,
    "debit_cents" BIGINT NOT NULL DEFAULT 0,
    "credit_cents" BIGINT NOT NULL DEFAULT 0,
    "memo" TEXT,
    "name" TEXT,
    "is_bridge" BOOLEAN NOT NULL DEFAULT false,
    "parent_line_id" UUID,
    "allocation_model_version_id" UUID,
    "allocation_target_id" UUID,
    "superseded_at" TIMESTAMPTZ(6),
    "superseded_by_audit_id" BIGINT,
    "source_row" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "transaction_id" UUID,
    "receipt_id" UUID,
    "kind" "NoteKind" NOT NULL,
    "body" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_year_checklist" (
    "id" UUID NOT NULL,
    "tax_year_id" UUID NOT NULL,
    "item_key" TEXT NOT NULL,
    "done_at" TIMESTAMPTZ(6),
    "done_by_id" UUID,
    "override_reason" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tax_year_checklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "page" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_seq_key" ON "transactions"("seq");

-- CreateIndex
CREATE INDEX "transactions_entity_id_date_idx" ON "transactions"("entity_id", "date");

-- CreateIndex
CREATE INDEX "transactions_date_idx" ON "transactions"("date");

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- CreateIndex
CREATE INDEX "transactions_bank_account_id_idx" ON "transactions"("bank_account_id");

-- CreateIndex
CREATE INDEX "transactions_vendor_idx" ON "transactions"("vendor");

-- CreateIndex
CREATE INDEX "transaction_lines_account_id_idx" ON "transaction_lines"("account_id");

-- CreateIndex
CREATE INDEX "transaction_lines_class_id_idx" ON "transaction_lines"("class_id");

-- CreateIndex
CREATE INDEX "transaction_lines_entity_id_idx" ON "transaction_lines"("entity_id");

-- CreateIndex
CREATE INDEX "transaction_lines_parent_line_id_idx" ON "transaction_lines"("parent_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_lines_transaction_id_line_no_key" ON "transaction_lines"("transaction_id", "line_no");

-- CreateIndex
CREATE INDEX "notes_transaction_id_kind_created_at_idx" ON "notes"("transaction_id", "kind", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tax_year_checklist_tax_year_id_item_key_key" ON "tax_year_checklist"("tax_year_id", "item_key");

-- CreateIndex
CREATE UNIQUE INDEX "saved_views_user_id_page_name_key" ON "saved_views"("user_id", "page", "name");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_parent_line_id_fkey" FOREIGN KEY ("parent_line_id") REFERENCES "transaction_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_year_checklist" ADD CONSTRAINT "tax_year_checklist_tax_year_id_fkey" FOREIGN KEY ("tax_year_id") REFERENCES "tax_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written additions (Prisma does not manage these; see docs/DESIGN.md §1–§4)
-- ===========================================================================

-- 1. Grants for the restricted app role. Transactions and notes are never deleted by the app;
--    lines may be deleted only while the parent is a draft (trigger below); nothing is truncated.
REVOKE DELETE, TRUNCATE ON "transactions" FROM ledger_app;
REVOKE DELETE, TRUNCATE ON "notes" FROM ledger_app;
REVOKE TRUNCATE ON "transaction_lines" FROM ledger_app;

-- 2. Checks Prisma cannot express.
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_amounts"
  CHECK ("debit_cents" >= 0 AND "credit_cents" >= 0 AND (("debit_cents" > 0) <> ("credit_cents" > 0)));
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_line_no_positive" CHECK ("line_no" > 0);
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_not_own_parent" CHECK ("parent_line_id" IS DISTINCT FROM "id");
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_posted_fields"
  CHECK ("status" <> 'POSTED' OR ("posted_at" IS NOT NULL AND "posted_by_id" IS NOT NULL));
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_voided_fields"
  CHECK ("status" <> 'VOIDED' OR ("voided_at" IS NOT NULL AND "void_reason" IS NOT NULL AND btrim("void_reason") <> ''));
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_ai_confidence_range"
  CHECK ("ai_confidence" IS NULL OR ("ai_confidence" >= 0 AND "ai_confidence" <= 1));
ALTER TABLE "notes" ADD CONSTRAINT "notes_target" CHECK ("transaction_id" IS NOT NULL OR "receipt_id" IS NOT NULL);

-- Import idempotency: one row per (source file, source row).
CREATE UNIQUE INDEX "transactions_source_file_ref_key" ON "transactions" ("source_file", "source_ref")
  WHERE "source_file" IS NOT NULL AND "source_ref" IS NOT NULL;
-- Live lines are what balance, reports and exports read.
CREATE INDEX "transaction_lines_live_idx" ON "transaction_lines" ("transaction_id") WHERE "superseded_at" IS NULL;
-- At most one user note per transaction; system notes are unlimited.
CREATE UNIQUE INDEX "notes_one_user_note_per_transaction" ON "notes" ("transaction_id")
  WHERE "kind" = 'USER' AND "transaction_id" IS NOT NULL;
-- Full-text search over every note.
CREATE INDEX "notes_body_fts_idx" ON "notes" USING GIN (to_tsvector('english', "body"));

-- 3. A bank-centric transaction's home entity is its bank account's entity.
CREATE OR REPLACE FUNCTION transactions_check_bank_entity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bank_entity uuid;
BEGIN
  IF NEW."bank_account_id" IS NULL THEN RETURN NEW; END IF;
  SELECT "entity_id" INTO bank_entity FROM "bank_accounts" WHERE "id" = NEW."bank_account_id";
  IF bank_entity IS DISTINCT FROM NEW."entity_id" THEN
    RAISE EXCEPTION 'A transaction on a bank account belongs to that bank account''s entity' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER transactions_bank_entity
  BEFORE INSERT OR UPDATE OF "bank_account_id", "entity_id" ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION transactions_check_bank_entity();

-- 4. Entity attribution of a line (docs/DESIGN.md §3, DECISIONS P0-24):
--    a line on a bank account's ledger account belongs to that bank account's entity; any other line
--    belongs to its class's entity; a General (shared-class) line belongs to the transaction's home
--    entity. Bridge lines are exempt from the class and home rules: the payer's General-class line and
--    the receiver's line (which carries the class it received, possibly a foreign one) each belong to
--    the entity they balance, and the per-entity balance trigger is what keeps them honest.
CREATE OR REPLACE FUNCTION transaction_lines_check_attribution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bank_entity uuid; cls record; home uuid;
BEGIN
  IF NEW."entity_id" IS NULL THEN RETURN NEW; END IF; -- incomplete draft; posting requires an entity
  IF NEW."account_id" IS NOT NULL THEN
    SELECT "entity_id" INTO bank_entity FROM "bank_accounts" WHERE "account_id" = NEW."account_id";
    IF FOUND THEN
      IF bank_entity <> NEW."entity_id" THEN
        RAISE EXCEPTION 'A line on a bank account''s ledger account belongs to that bank account''s entity' USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF NEW."is_bridge" THEN RETURN NEW; END IF;
  IF NEW."class_id" IS NOT NULL THEN
    SELECT "entity_id", "is_shared" INTO cls FROM "classes" WHERE "id" = NEW."class_id";
    IF NOT cls."is_shared" THEN
      IF cls."entity_id" <> NEW."entity_id" THEN
        RAISE EXCEPTION 'A line belongs to the entity of its class' USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;
  END IF;
  SELECT "entity_id" INTO home FROM "transactions" WHERE "id" = NEW."transaction_id";
  IF home <> NEW."entity_id" THEN
    RAISE EXCEPTION 'A General-class line belongs to the transaction''s home entity' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER transaction_lines_attribution
  BEFORE INSERT OR UPDATE OF "account_id", "class_id", "entity_id", "is_bridge" ON "transaction_lines"
  FOR EACH ROW EXECUTE FUNCTION transaction_lines_check_attribution();

-- 5. Lines of a posted transaction are never changed or deleted, only superseded (P0-21); a superseded line
--    is immutable; lines of a voided transaction stay exactly as they were.
CREATE OR REPLACE FUNCTION transaction_lines_protect() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT "status"::text INTO st FROM "transactions" WHERE "id" = OLD."transaction_id";
  IF TG_OP = 'DELETE' THEN
    IF st NOT IN ('DRAFT', 'FLAGGED') THEN
      RAISE EXCEPTION 'Lines of a % transaction are never deleted; they are superseded', lower(st) USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."superseded_at" IS NOT NULL THEN
    RAISE EXCEPTION 'A superseded line is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF st = 'VOIDED' THEN
    RAISE EXCEPTION 'Lines of a voided transaction cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF st = 'POSTED' AND (
       NEW."superseded_at" IS NULL
    OR ROW(NEW."transaction_id", NEW."line_no", NEW."account_id", NEW."class_id", NEW."entity_id",
           NEW."debit_cents", NEW."credit_cents", NEW."memo", NEW."name", NEW."is_bridge", NEW."parent_line_id",
           NEW."allocation_model_version_id", NEW."allocation_target_id", NEW."source_row", NEW."created_at")
       IS DISTINCT FROM
       ROW(OLD."transaction_id", OLD."line_no", OLD."account_id", OLD."class_id", OLD."entity_id",
           OLD."debit_cents", OLD."credit_cents", OLD."memo", OLD."name", OLD."is_bridge", OLD."parent_line_id",
           OLD."allocation_model_version_id", OLD."allocation_target_id", OLD."source_row", OLD."created_at")) THEN
    RAISE EXCEPTION 'Lines of a posted transaction cannot be changed; supersede them and insert new lines' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER transaction_lines_protect
  BEFORE UPDATE OR DELETE ON "transaction_lines"
  FOR EACH ROW EXECUTE FUNCTION transaction_lines_protect();

-- 6. The double-entry invariants, checked once per transaction at COMMIT (deferred), over live lines:
--    (a) every entity present among the live lines balances (which implies the whole entry balances, P0-2);
--    (b) at least two live lines unless the transaction is voided (P0-3);
--    (c) a posted transaction has an account, a class and an entity on every live line (P0-25);
--    (d) split children point at a superseded parent of the same transaction and sum to it on the same side.
CREATE OR REPLACE FUNCTION transactions_check_invariants(p_transaction_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t record; bad record; live_count int;
BEGIN
  SELECT "id", "status", "seq" INTO t FROM "transactions" WHERE "id" = p_transaction_id;
  IF NOT FOUND THEN RETURN; END IF;
  FOR bad IN
    SELECT "entity_id", sum("debit_cents") AS dr, sum("credit_cents") AS cr
    FROM "transaction_lines" WHERE "transaction_id" = t."id" AND "superseded_at" IS NULL
    GROUP BY "entity_id" HAVING sum("debit_cents") <> sum("credit_cents")
  LOOP
    RAISE EXCEPTION 'Transaction #% does not balance for entity %: debits % do not equal credits %',
      t."seq", coalesce(bad."entity_id"::text, '(none)'), bad.dr, bad.cr USING ERRCODE = 'check_violation';
  END LOOP;
  SELECT count(*) INTO live_count FROM "transaction_lines" WHERE "transaction_id" = t."id" AND "superseded_at" IS NULL;
  IF t."status" <> 'VOIDED' AND live_count < 2 THEN
    RAISE EXCEPTION 'Transaction #% needs at least two lines (it has %)', t."seq", live_count USING ERRCODE = 'check_violation';
  END IF;
  IF t."status" = 'POSTED' AND EXISTS (
    SELECT 1 FROM "transaction_lines"
    WHERE "transaction_id" = t."id" AND "superseded_at" IS NULL
      AND ("account_id" IS NULL OR "class_id" IS NULL OR "entity_id" IS NULL)) THEN
    RAISE EXCEPTION 'Transaction #% cannot be posted: every line needs an account, a class and an entity', t."seq" USING ERRCODE = 'check_violation';
  END IF;
  FOR bad IN
    SELECT p."id" AS parent_id, p."transaction_id" AS parent_tx, p."superseded_at" AS parent_superseded,
           p."debit_cents" AS pdr, p."credit_cents" AS pcr,
           sum(c."debit_cents") AS cdr, sum(c."credit_cents") AS ccr
    FROM "transaction_lines" c JOIN "transaction_lines" p ON p."id" = c."parent_line_id"
    WHERE c."transaction_id" = t."id" AND c."superseded_at" IS NULL
    GROUP BY p."id"
  LOOP
    IF bad.parent_tx <> t."id" THEN
      RAISE EXCEPTION 'Transaction #%: a split child must point at a line of the same transaction', t."seq" USING ERRCODE = 'check_violation';
    END IF;
    IF bad.parent_superseded IS NULL THEN
      RAISE EXCEPTION 'Transaction #%: the parent of a split line must be superseded', t."seq" USING ERRCODE = 'check_violation';
    END IF;
    IF bad.cdr <> bad.pdr OR bad.ccr <> bad.pcr THEN
      RAISE EXCEPTION 'Transaction #%: split lines must add up to the line they replace (% / % vs % / %)',
        t."seq", bad.cdr, bad.ccr, bad.pdr, bad.pcr USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION transaction_lines_invariants_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM transactions_check_invariants(OLD."transaction_id");
  ELSE
    PERFORM transactions_check_invariants(NEW."transaction_id");
    IF TG_OP = 'UPDATE' AND NEW."transaction_id" <> OLD."transaction_id" THEN
      PERFORM transactions_check_invariants(OLD."transaction_id");
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER transaction_lines_invariants
  AFTER INSERT OR UPDATE OR DELETE ON "transaction_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION transaction_lines_invariants_trigger();

CREATE OR REPLACE FUNCTION transactions_invariants_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM transactions_check_invariants(NEW."id");
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER transactions_invariants
  AFTER INSERT OR UPDATE ON "transactions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION transactions_invariants_trigger();

-- 7. The tax-year lock (docs/DESIGN.md §4, DECISIONS P0-22). A write that touches a POSTED or VOIDED
--    transaction — or moves a draft to one of those states — is refused when any (line entity, year of date)
--    it involves is CLOSED or FILED, unless the same database transaction has run
--    SELECT set_config('app.lock_override_reason', '<reason>', true), which the app does only after the
--    user typed a reason and an audit row with is_lock_override = true was written. Drafts are never locked.
CREATE OR REPLACE FUNCTION lock_assert(p_entity uuid, p_year int, p_what text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  IF p_entity IS NULL OR p_year IS NULL THEN RETURN; END IF;
  SELECT "state"::text INTO st FROM "tax_years" WHERE "entity_id" = p_entity AND "year" = p_year;
  IF st IN ('CLOSED', 'FILED') AND coalesce(current_setting('app.lock_override_reason', true), '') = '' THEN
    RAISE EXCEPTION 'LOCKED_YEAR: tax year % is % for entity % (%)', p_year, lower(st), p_entity, p_what
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION transactions_lock_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e uuid; old_year int; new_year int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" IN ('POSTED', 'VOIDED') THEN
      PERFORM lock_assert(NEW."entity_id", extract(year FROM NEW."date")::int, 'new transaction');
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" IN ('DRAFT', 'FLAGGED') AND NEW."status" IN ('DRAFT', 'FLAGGED') THEN RETURN NEW; END IF;
  old_year := extract(year FROM OLD."date")::int;
  new_year := extract(year FROM NEW."date")::int;
  FOR e IN
    SELECT DISTINCT x FROM (
      SELECT OLD."entity_id" AS x
      UNION SELECT NEW."entity_id"
      UNION SELECT "entity_id" FROM "transaction_lines" WHERE "transaction_id" = OLD."id" AND "superseded_at" IS NULL
    ) s WHERE x IS NOT NULL
  LOOP
    PERFORM lock_assert(e, old_year, 'transaction #' || OLD."seq");
    IF new_year <> old_year THEN PERFORM lock_assert(e, new_year, 'transaction #' || OLD."seq" || ' (new date)'); END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER transactions_lock
  BEFORE INSERT OR UPDATE ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION transactions_lock_check();

CREATE OR REPLACE FUNCTION transaction_lines_lock_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t record; yr int; tx_id uuid;
BEGIN
  tx_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."transaction_id" ELSE NEW."transaction_id" END;
  SELECT "status", "date", "entity_id", "seq" INTO t FROM "transactions" WHERE "id" = tx_id;
  IF NOT FOUND OR t."status" IN ('DRAFT', 'FLAGGED') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  yr := extract(year FROM t."date")::int;
  PERFORM lock_assert(t."entity_id", yr, 'transaction #' || t."seq");
  IF TG_OP <> 'INSERT' THEN PERFORM lock_assert(OLD."entity_id", yr, 'transaction #' || t."seq" || ' line'); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM lock_assert(NEW."entity_id", yr, 'transaction #' || t."seq" || ' line'); END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER transaction_lines_lock
  BEFORE INSERT OR UPDATE OR DELETE ON "transaction_lines"
  FOR EACH ROW EXECUTE FUNCTION transaction_lines_lock_check();

-- 8. System notes are append-only; a note never changes kind.
CREATE OR REPLACE FUNCTION notes_protect_system() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."kind" = 'SYSTEM' THEN
    RAISE EXCEPTION 'System notes are append-only (% is not allowed)', TG_OP USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."kind" <> OLD."kind" THEN
    RAISE EXCEPTION 'A note cannot change kind' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER notes_protect_system
  BEFORE UPDATE OR DELETE ON "notes"
  FOR EACH ROW EXECUTE FUNCTION notes_protect_system();
