import type { PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/lib/auth/password";
import {
  loadSeedAccounts,
  loadSeedClasses,
  SEED_BANK_ACCOUNTS,
  SEED_ENTITIES,
  SEED_TAX_YEARS,
  seedUsersFromEnv,
  type SeedUser,
} from "@/lib/seed/seed-data";
import { SETTING_KEYS } from "@/lib/settings";

export interface SeedSummary {
  entities: { created: number; existing: number };
  accounts: { created: number; existing: number };
  bankAccounts: { created: number; existing: number };
  classes: { created: number; existing: number };
  bridgeRules: { created: number; existing: number };
  taxYears: { created: number; existing: number };
  settings: { created: number; existing: number };
  users: { created: number; existing: number };
  appRolePasswordSet: boolean;
}

export interface SeedOptions {
  seedDir?: string;
  users?: SeedUser[];
  appDbPassword?: string | null;
  log?: (line: string) => void;
}

/**
 * Idempotent seed. Creates whatever is missing and never overwrites anything a user may have edited
 * (account names, class flags, passwords, roles). Safe to run on every deploy.
 */
export async function runSeed(prisma: PrismaClient, opts: SeedOptions = {}): Promise<SeedSummary> {
  const log = opts.log ?? (() => {});
  const summary: SeedSummary = {
    entities: { created: 0, existing: 0 },
    accounts: { created: 0, existing: 0 },
    bankAccounts: { created: 0, existing: 0 },
    classes: { created: 0, existing: 0 },
    bridgeRules: { created: 0, existing: 0 },
    taxYears: { created: 0, existing: 0 },
    settings: { created: 0, existing: 0 },
    users: { created: 0, existing: 0 },
    appRolePasswordSet: false,
  };

  // Entities
  const entityIds = new Map<string, string>();
  for (const e of SEED_ENTITIES) {
    const existing = await prisma.entity.findUnique({ where: { code: e.code } });
    if (existing) {
      entityIds.set(e.code, existing.id);
      summary.entities.existing++;
    } else {
      const created = await prisma.entity.create({
        data: { code: e.code, name: e.name, legalName: e.legalName, taxForm: e.taxForm },
      });
      entityIds.set(e.code, created.id);
      summary.entities.created++;
    }
  }

  // Chart of accounts
  const accountIds = new Map<string, string>();
  for (const a of loadSeedAccounts(opts.seedDir)) {
    const existing = await prisma.account.findUnique({ where: { number: a.number } });
    if (existing) {
      accountIds.set(a.number, existing.id);
      summary.accounts.existing++;
    } else {
      const created = await prisma.account.create({
        data: {
          number: a.number,
          name: a.name,
          parentGroup: a.parentGroup,
          type: a.type,
          subType: a.subType,
          subType2: a.subType2,
          source: a.source || null,
          note: a.note || null,
        },
      });
      accountIds.set(a.number, created.id);
      summary.accounts.created++;
    }
  }

  // Bank accounts
  for (const b of SEED_BANK_ACCOUNTS) {
    const accountId = accountIds.get(b.accountNumber);
    const entityId = entityIds.get(b.entityCode);
    if (!accountId || !entityId)
      throw new Error(
        `Seed bank account ${b.accountNumber} refers to an unknown account or entity`,
      );
    const existing = await prisma.bankAccount.findUnique({ where: { accountId } });
    if (existing) {
      summary.bankAccounts.existing++;
    } else {
      await prisma.bankAccount.create({
        data: {
          entityId,
          accountId,
          name: b.name,
          institution: b.institution,
          kind: b.kind,
          openedOn: b.openedOn ? new Date(b.openedOn) : null,
          closedOn: b.closedOn ? new Date(b.closedOn) : null,
          isActive: b.isActive,
        },
      });
      summary.bankAccounts.created++;
    }
  }

  // Classes
  for (const c of loadSeedClasses(opts.seedDir)) {
    const entityId = entityIds.get(c.entityCode);
    if (!entityId) throw new Error(`Seed class ${c.name} refers to unknown entity ${c.entityCode}`);
    const existing = await prisma.class.findUnique({ where: { name: c.name } });
    if (existing) {
      summary.classes.existing++;
    } else {
      await prisma.class.create({
        data: {
          name: c.name,
          entityId,
          isShared: c.isShared,
          isLegalEntity: c.isLegalEntity,
          legalEntityName: c.legalEntityName,
          kind: c.kind,
          yearsNote: c.yearsNote || null,
          note: c.note || null,
          sortOrder: c.sortOrder,
          isActive: c.isActive,
        },
      });
      summary.classes.created++;
    }
  }

  // Cross-entity bridge rules (default: distribution / contribution) in both directions.
  const distribution = accountIds.get("3102");
  const contribution = accountIds.get("3101");
  if (distribution && contribution) {
    for (const [payer, receiver] of [
      ["SREI", "PLA"],
      ["PLA", "SREI"],
    ] as const) {
      const payerEntityId = entityIds.get(payer) as string;
      const receiverEntityId = entityIds.get(receiver) as string;
      const existing = await prisma.entityBridgeRule.findUnique({
        where: { payerEntityId_receiverEntityId: { payerEntityId, receiverEntityId } },
      });
      if (existing) {
        summary.bridgeRules.existing++;
      } else {
        await prisma.entityBridgeRule.create({
          data: {
            payerEntityId,
            receiverEntityId,
            mode: "DISTRIBUTION_CONTRIBUTION",
            payerAccountId: distribution,
            receiverAccountId: contribution,
          },
        });
        summary.bridgeRules.created++;
      }
    }
  }

  // Tax years
  for (const t of SEED_TAX_YEARS) {
    const entityId = entityIds.get(t.entityCode) as string;
    const existing = await prisma.taxYear.findUnique({
      where: { entityId_year: { entityId, year: t.year } },
    });
    if (existing) {
      summary.taxYears.existing++;
    } else {
      await prisma.taxYear.create({
        data: {
          entityId,
          year: t.year,
          state: t.state,
          note:
            t.state === "FILED" ? "Imported history (Phase 2); marked filed per CLAUDE.md" : null,
        },
      });
      summary.taxYears.created++;
    }
  }

  // Settings defaults (only when missing)
  const defaults: { key: string; value: unknown }[] = [
    {
      key: SETTING_KEYS.plaLaunchDate,
      value: {
        date: "2025-06-02",
        isPlaceholder: true,
        note: "Bank account opening date used as a placeholder (decision D2).",
      },
    },
    {
      key: SETTING_KEYS.receiptRequiredVendorTypes,
      value: ["hardware stores", "Amazon", "restaurants", "gas stations", "contractors"],
    },
    { key: SETTING_KEYS.ai, value: { model: "claude-sonnet-5", monthlySpendCapCents: 5000 } },
    { key: SETTING_KEYS.numberFormat, value: { negative: "parens" } },
  ];
  for (const s of defaults) {
    const existing = await prisma.setting.findUnique({
      where: { scope_key: { scope: "GLOBAL", key: s.key } },
    });
    if (existing) {
      summary.settings.existing++;
    } else {
      await prisma.setting.create({
        data: { scope: "GLOBAL", key: s.key, value: s.value as never },
      });
      summary.settings.created++;
    }
  }

  // Users (from environment). Never overwrite an existing user's password or role.
  const users = opts.users ?? seedUsersFromEnv();
  for (const u of users) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (existing) {
      summary.users.existing++;
      continue;
    }
    await prisma.user.create({
      data: {
        email: u.email,
        displayName: u.displayName,
        passwordHash: await hashPassword(u.password),
        role: u.role,
      },
    });
    summary.users.created++;
    log(`Created user ${u.email} (${u.role}); MFA enrollment will be required at first login.`);
  }
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    log(
      "WARNING: no users exist and none are configured. Set SEED_OWNER_* and SEED_FULL_* in .env and re-run the seed.",
    );
  }

  // Password for the restricted app role.
  const appPassword =
    opts.appDbPassword === undefined ? process.env.APP_DB_PASSWORD : opts.appDbPassword;
  if (appPassword) {
    const escaped = appPassword.replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`ALTER ROLE ledger_app WITH LOGIN PASSWORD '${escaped}'`);
    summary.appRolePasswordSet = true;
  }

  await prisma.auditLog.create({
    data: { action: "seed.run", subjectType: "system", after: summary as never },
  });
  return summary;
}
