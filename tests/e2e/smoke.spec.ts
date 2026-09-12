import "dotenv/config";
import { expect, test } from "@playwright/test";
import { generateSync } from "otplib";
import { createPrismaClient } from "../../src/lib/db";
import { hashPassword } from "../../src/lib/auth/password";

/**
 * Login → MFA enrollment → dashboard → sign out. Creates its own user so it never depends on the seed.
 * Needs the dev database from .env (DATABASE_URL, owner role).
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
  await expect(page.getByText("Save these recovery codes")).toBeVisible();
  await expect(page.locator("ul li.select-all")).toHaveCount(10);
  await page.getByRole("link", { name: /continue/i }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: /Welcome back, Smoke/ })).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings\/users/);

  await page.getByRole("button", { name: /Smoke Tester/ }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
