import { expect, test } from "../fixtures";

test("ACC-009: test mode banner is visible", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("test-mode-banner")).toBeVisible();
});

test("ACC-004: pending user sees pending notice", async ({ page, loginAs }) => {
  await loginAs("seed-carol");
  await page.goto("/dashboard");
  await expect(page.getByTestId("account-pending")).toBeVisible();
  await expect(page.getByTestId("dashboard-empty")).toHaveCount(0);
});

test("ACC-004: suspended user sees suspended notice", async ({ page, loginAs }) => {
  await loginAs("seed-dan");
  await page.goto("/dashboard");
  await expect(page.getByTestId("account-suspended")).toBeVisible();
  await expect(page.getByTestId("dashboard-empty")).toHaveCount(0);
});

test("ACC-004: rejected user sees rejected notice", async ({ page, loginAs }) => {
  await loginAs("seed-erin");
  await page.goto("/dashboard");
  await expect(page.getByTestId("account-rejected")).toBeVisible();
  await expect(page.getByTestId("dashboard-empty")).toHaveCount(0);
});

test("ACC-004: approved user sees empty dashboard without support link", async ({ page, loginAs }) => {
  await loginAs("seed-alice");
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-empty")).toBeVisible();
  await expect(page.getByTestId("nav-support")).toHaveCount(0);
});

test("ACC-004: admin sees the support link on the dashboard", async ({ page, loginAs }) => {
  await loginAs("seed-admin");
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-empty")).toBeVisible();
  await expect(page.getByTestId("nav-support")).toBeVisible();
});

test("ACC-001: brand-new subject lands on pending notice", async ({ page, loginAs }) => {
  await loginAs("new-visitor-1");
  await page.goto("/dashboard");
  await expect(page.getByTestId("account-pending")).toBeVisible();
});

test("ACC-001: login page lets a seed user sign in", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-as-seed-alice").click();
  await expect(page.getByTestId("login-signed-in")).toBeVisible();
  // The session lives in sessionStorage, so it survives the navigation.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("dashboard-empty")).toBeVisible();
});

test("ACC-001: signed-out visitor is sent to the login page", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId("login-as-seed-alice")).toBeVisible();
});
