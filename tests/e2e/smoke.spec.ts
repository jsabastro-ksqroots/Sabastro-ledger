import "dotenv/config";
import { expect, test } from "@playwright/test";
import { generateSync } from "otplib";
import { createPrismaClient } from "../../src/lib/db";
import { hashPassword } from "../../src/lib/auth/password";

/**
 * Login → MFA enrollment → dashboard → ledger (enter and post a transaction) → sign out. Creates its own
 * user so it never depends on the seeded users; the ledger step needs the seeded chart, classes and
 * bank accounts. Needs the dev database from .env (DATABASE_URL, owner role).
 */
const PASSWORD = "Smoke-Test-Password-1";
const email = `smoke-${Date.now()}@test.local`;
const owner = createPrismaClient(process.env.DATABASE_URL as string);

test.beforeAll(async () => {
  await owner.user.create({
    data: {
      email,
      displayName: "Smoke Tester",
      passwordHash: await hashPassword(PASSWORD),
      role: "FULL",
    },
  });
});

test.afterAll(async () => {
  await owner.user.updateMany({ where: { email }, data: { isActive: false } });
  await owner.$disconnect();
});

test("sign in, enrol an authenticator, reach the dashboard, sign out", async ({ page }) => {
  await page.goto("/ledger");
  await expect(page).toHaveURL(/\/login\?next=%2Fledger/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/mfa\/enroll/);
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();

  const key =
    (await page.locator("div.font-mono.select-all").first().textContent())?.replace(/\s+/g, "") ??
    "";
  expect(key.length).toBeGreaterThan(10);
  await page.getByLabel("6-digit code from the app").fill(generateSync({ secret: key }));
  await page.getByRole("button", { name: "Finish setup" }).click();
  // The action hashes ten recovery codes; give the dev server time on a first compile.
  await expect(page.getByText("Save these recovery codes")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("ul li.select-all")).toHaveCount(10);
  const recoveryCodes = await page.locator("ul li.select-all").allTextContents();
  await page.getByRole("link", { name: /continue/i }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: /Welcome back, Smoke/ })).toBeVisible();

  // Ledger (Phase 1): enter a simple row and see it posted in the grid.
  await page.getByRole("link", { name: "Ledger" }).click();
  await expect(page).toHaveURL(/\/ledger/);
  await page.getByRole("button", { name: "New transaction" }).click();
  await page.getByLabel("Date").fill("2025-06-15");
  await page.getByLabel("Vendor / payee").fill(`Smoke Vendor ${Date.now()}`);
  await page.getByLabel("Amount").fill("-42.10");
  await page
    .getByLabel("Account", { exact: true })
    .selectOption({ label: "5215 Supplies Expense" });
  await page.getByLabel("Class", { exact: true }).selectOption({ label: "General (shared)" });
  await page.getByRole("button", { name: "Save and post" }).click();
  await expect(page.getByRole("cell", { name: /Smoke Vendor/ }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("(42.10)").first()).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings\/users/);

  await page.getByRole("button", { name: /Smoke Tester/ }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);

  // Second sign-in: password, then a fresh authenticator code (next time step, so it is not a replay).
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/mfa\/verify/);
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/not right/)).toBeVisible({ timeout: 15_000 });
  const nextStep = Math.floor(Date.now() / 1000) + 30;
  await page.getByLabel("6-digit code").fill(generateSync({ secret: key, epoch: nextStep }));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

  // Third sign-in with a recovery code, which only works once.
  await page.getByRole("button", { name: /Smoke Tester/ }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/mfa\/verify/);
  await page.getByRole("button", { name: /recovery code/i }).click();
  await page.getByLabel("Recovery code").fill(recoveryCodes[0] as string);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
});
