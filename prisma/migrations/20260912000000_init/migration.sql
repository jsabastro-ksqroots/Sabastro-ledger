-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'FULL', 'LIMITED', 'VIEW_ONLY');

-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('VIEW_LEDGER', 'UPLOAD_RECEIPTS', 'REVIEW_CONFIRM', 'EDIT_POSTED', 'MANAGE_MODELS', 'RUN_REPORTS', 'EXPORT', 'VIEW_SETTINGS', 'MANAGE_USERS', 'CLOSE_YEAR');

-- CreateEnum
CREATE TYPE "TaxForm" AS ENUM ('FORM_1065', 'SCHEDULE_C', 'FORM_1120S');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "BankAccountKind" AS ENUM ('CHECKING', 'SAVINGS', 'CASH_APP');

-- CreateEnum
CREATE TYPE "ClassKind" AS ENUM ('GENERAL', 'RENTAL', 'LAND', 'FLIP', 'BUSINESS');

-- CreateEnum
CREATE TYPE "BridgeMode" AS ENUM ('DISTRIBUTION_CONTRIBUTION', 'INTERCOMPANY');

-- CreateEnum
CREATE TYPE "TaxYearState" AS ENUM ('OPEN', 'CLOSED', 'FILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "mfa_secret_enc" TEXT,
    "mfa_enrolled_at" TIMESTAMPTZ(6),
    "mfa_last_time_step" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "lockout_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "user_id" UUID NOT NULL,
    "permission" "Permission" NOT NULL,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_id","permission")
);

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "mfa_verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" BIGSERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "session_id" UUID,
    "action" TEXT NOT NULL,
    "subject_type" TEXT,
    "subject_id" TEXT,
    "subject_label" TEXT,
    "entity_id" UUID,
    "tax_year_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "is_lock_override" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entities" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "tax_form" "TaxForm" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_group" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "sub_type" TEXT NOT NULL,
    "sub_type_2" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "institution" TEXT,
    "kind" "BankAccountKind" NOT NULL DEFAULT 'CHECKING',
    "last4" TEXT,
    "opened_on" DATE,
    "closed_on" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "is_shared" BOOLEAN NOT NULL DEFAULT false,
    "is_legal_entity" BOOLEAN NOT NULL DEFAULT false,
    "legal_entity_name" TEXT,
    "kind" "ClassKind" NOT NULL,
    "years_note" TEXT,
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_bridge_rules" (
    "id" UUID NOT NULL,
    "payer_entity_id" UUID NOT NULL,
    "receiver_entity_id" UUID NOT NULL,
    "mode" "BridgeMode" NOT NULL DEFAULT 'DISTRIBUTION_CONTRIBUTION',
    "payer_account_id" UUID NOT NULL,
    "receiver_account_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "entity_bridge_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_years" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "state" "TaxYearState" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMPTZ(6),
    "closed_by_id" UUID,
    "filed_at" TIMESTAMPTZ(6),
    "filed_by_id" UUID,
    "override_count" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tax_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "recovery_codes_user_id_idx" ON "recovery_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "login_attempts_email_attempted_at_idx" ON "login_attempts"("email", "attempted_at");

-- CreateIndex
CREATE INDEX "login_attempts_ip_attempted_at_idx" ON "login_attempts"("ip", "attempted_at");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- CreateIndex
CREATE INDEX "audit_log_user_id_at_idx" ON "audit_log"("user_id", "at");

-- CreateIndex
CREATE INDEX "audit_log_action_at_idx" ON "audit_log"("action", "at");

-- CreateIndex
CREATE INDEX "audit_log_entity_id_at_idx" ON "audit_log"("entity_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "entities_code_key" ON "entities"("code");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_number_key" ON "accounts"("number");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_account_id_key" ON "bank_accounts"("account_id");

-- CreateIndex
CREATE INDEX "bank_accounts_entity_id_idx" ON "bank_accounts"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "classes_name_key" ON "classes"("name");

-- CreateIndex
CREATE INDEX "classes_entity_id_idx" ON "classes"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "entity_bridge_rules_payer_entity_id_receiver_entity_id_key" ON "entity_bridge_rules"("payer_entity_id", "receiver_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_years_entity_id_year_key" ON "tax_years"("entity_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "settings_scope_key_key" ON "settings"("scope", "key");

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_bridge_rules" ADD CONSTRAINT "entity_bridge_rules_payer_entity_id_fkey" FOREIGN KEY ("payer_entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_bridge_rules" ADD CONSTRAINT "entity_bridge_rules_receiver_entity_id_fkey" FOREIGN KEY ("receiver_entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_bridge_rules" ADD CONSTRAINT "entity_bridge_rules_payer_account_id_fkey" FOREIGN KEY ("payer_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_bridge_rules" ADD CONSTRAINT "entity_bridge_rules_receiver_account_id_fkey" FOREIGN KEY ("receiver_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_years" ADD CONSTRAINT "tax_years_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written additions (Prisma does not manage these; see docs/DESIGN.md)
-- ===========================================================================

-- 1. Restricted application role. Migrations and the seed run as the database owner; the app itself
--    connects as ledger_app. The seed sets the real password from APP_DB_PASSWORD.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_app') THEN
    CREATE ROLE ledger_app LOGIN PASSWORD 'change-me-ledger-app';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO ledger_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ledger_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ledger_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ledger_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ledger_app;

-- Append-only tables for the app role.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM ledger_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "login_attempts" FROM ledger_app;
-- Users are deactivated, never deleted.
REVOKE DELETE, TRUNCATE ON "users" FROM ledger_app;
-- Prisma's migration bookkeeping is not the app's business.
REVOKE ALL ON "_prisma_migrations" FROM ledger_app;

-- 2. Nobody updates or deletes audit rows, whatever their role (a superuser could drop this trigger,
--    which is exactly the kind of thing the nightly backups exist for).
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% is not allowed)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();

-- 3. Exactly one active Owner.
CREATE UNIQUE INDEX "users_single_active_owner" ON "users" ((true)) WHERE "role" = 'OWNER' AND "is_active" = true;

-- 4. Checks Prisma cannot express.
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_number_4_digits" CHECK ("number" ~ '^[0-9]{4}$');
ALTER TABLE "tax_years" ADD CONSTRAINT "tax_years_year_range" CHECK ("year" BETWEEN 2000 AND 2100);
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_dates" CHECK ("closed_on" IS NULL OR "opened_on" IS NULL OR "closed_on" >= "opened_on");
ALTER TABLE "entity_bridge_rules" ADD CONSTRAINT "entity_bridge_rules_distinct_entities" CHECK ("payer_entity_id" <> "receiver_entity_id");
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));

-- A bank account must point at a ledger account whose sub-type is Bank.
CREATE OR REPLACE FUNCTION bank_accounts_check_account_type() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  SELECT "sub_type" INTO t FROM "accounts" WHERE "id" = NEW."account_id";
  IF t IS DISTINCT FROM 'Bank' THEN
    RAISE EXCEPTION 'bank_accounts.account_id must reference an account with sub_type Bank' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER bank_accounts_account_type
  BEFORE INSERT OR UPDATE OF "account_id" ON "bank_accounts"
  FOR EACH ROW EXECUTE FUNCTION bank_accounts_check_account_type();

-- 5. Tax-year state only moves forward (OPEN -> CLOSED -> FILED). Re-opening is an override that must
--    happen in a database transaction that has set app.lock_override_reason (the app does this only
--    after the user typed a reason; Phase 1 extends the same mechanism to transactions and lines).
CREATE OR REPLACE FUNCTION tax_years_state_forward() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rank_old int; rank_new int;
BEGIN
  rank_old := CASE OLD."state" WHEN 'OPEN' THEN 0 WHEN 'CLOSED' THEN 1 WHEN 'FILED' THEN 2 END;
  rank_new := CASE NEW."state" WHEN 'OPEN' THEN 0 WHEN 'CLOSED' THEN 1 WHEN 'FILED' THEN 2 END;
  IF rank_new < rank_old AND coalesce(current_setting('app.lock_override_reason', true), '') = '' THEN
    RAISE EXCEPTION 'Tax year % is % and cannot be re-opened without an override reason', OLD."year", OLD."state"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tax_years_state_forward
  BEFORE UPDATE OF "state" ON "tax_years"
  FOR EACH ROW EXECUTE FUNCTION tax_years_state_forward();

-- 6. The Owner cannot be demoted or deactivated except through an explicit ownership transfer, which
--    runs in a transaction that sets app.owner_transfer = 'yes' (see src/lib/users.ts changeOwner).
CREATE OR REPLACE FUNCTION users_protect_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."role" = 'OWNER' AND (NEW."role" <> 'OWNER' OR NEW."is_active" = false)
     AND coalesce(current_setting('app.owner_transfer', true), '') <> 'yes' THEN
    RAISE EXCEPTION 'The Owner cannot be demoted or deactivated; use Change owner' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER users_protect_owner
  BEFORE UPDATE OF "role", "is_active" ON "users"
  FOR EACH ROW EXECUTE FUNCTION users_protect_owner();
