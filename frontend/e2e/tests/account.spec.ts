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

test("ACC-004: approved user sees empty dashboard without support entry", async ({ page, loginAs }) => {
  await loginAs("seed-alice");
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-empty")).toBeVisible();
  await expect(page.getByTestId("nav-support")).toHaveCount(0);
  await expect(page.getByTestId("tab-support")).toHaveCount(0);
});

test("ACC-004 ADM-001: admin sees the support entry of the navigation", async ({ page, loginAs }) => {
  await loginAs("seed-admin");
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-empty")).toBeVisible();
  await expect(page.locator('[data-testid="nav-support"]:visible, [data-testid="tab-support"]:visible')).toBeVisible();
});

test("ACC-001: brand-new subject lands on pending notice", async ({ page, loginAs }) => {
  await loginAs("new-visitor-1");
  await page.goto("/dashboard");
  await expect(page.getByTestId("account-pending")).toBeVisible();
});

test("ACC-001: login page lets a seed user sign in", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-as-seed-alice").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("dashboard-empty")).toBeVisible();
});

test("ACC-001: signed-out visitor is sent to the login page", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId("login-as-seed-alice")).toBeVisible();
});

test("ACC-011 ACC-026 a pending account sees its email and can sign out", async ({ page, loginAs }) => {
  await loginAs("seed-carol");
  await page.goto("/dashboard");
  await expect(page.getByTestId("account-pending")).toContainText("Ton compte est en attente de validation");
  await expect(page.getByTestId("account-pending")).toContainText("carole@example.test");
  await page.getByTestId("sign-out").click();
  await expect(page).toHaveURL(/\/login$/);
});

test("ACC-026 a suspended account can contact support", async ({ page, loginAs }) => {
  await loginAs("seed-dan");
  await page.goto("/dashboard");
  await expect(page.getByTestId("account-support")).toHaveAttribute("href", "mailto:support@cartouche.invalid");
});

test("ACC-025 the sign-in page links to the terms and the privacy policy", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Conditions générales d’utilisation" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Politique de confidentialité" })).toBeVisible();
});

test("ACC-025 the sample card never covers the arguments of the sign-in page", async ({ page, isMobile }) => {
  test.skip(isMobile, "the arguments and the sample card show from 600 px");
  await page.goto("/login");
  const list = await page.getByTestId("login-arguments").boundingBox();
  const preview = await page.getByTestId("login-card-preview").boundingBox();
  expect(list).not.toBeNull();
  expect(preview).not.toBeNull();
  expect(preview!.y).toBeGreaterThanOrEqual(list!.y + list!.height);
});
