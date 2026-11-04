import { expect, test } from "../fixtures";

test.beforeEach(async ({ api, loginAs }) => {
  await api.seed("base");
  await api.seed("cards");
  await loginAs("seed-alice");
});

// The mobile project is a phone (390 px), the desktop project a computer (1280 px): the shell shows the
// side bar on one and the tab bar on the other, with the same three entries.
test("EDI-022 navigation on a computer and on a phone", async ({ page }, testInfo) => {
  const phone = testInfo.project.name === "mobile";
  await page.goto("/dashboard");
  const nav = page.getByRole("navigation", { name: "Navigation principale" }).locator("visible=true");
  await expect(nav).toHaveCount(1);
  await expect(page.getByTestId(phone ? "tab-cards" : "nav-cards")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId(phone ? "nav-cards" : "tab-cards")).toBeHidden();
  if (!phone) await expect(page.getByTestId("shell-user-email")).toHaveText("alice@example.test");

  const entry = (side: string, tab: string) => page.getByTestId(phone ? tab : side);

  await entry("nav-contacts", "tab-contacts").click();
  await expect(page).toHaveURL(/\/dashboard\/contacts$/);
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await expect(entry("nav-contacts", "tab-contacts")).toHaveAttribute("aria-current", "page");

  await entry("account-link", "tab-account").click();
  await expect(page).toHaveURL(/\/dashboard\/account$/);
  await expect(page.getByTestId("account-email")).toHaveText("alice@example.test");

  await entry("nav-cards", "tab-cards").click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("EDI-022 the pages of a card have a breadcrumb on a computer and a back action on a phone", async ({ page }, testInfo) => {
  await page.goto("/dashboard/cards/new");
  if (testInfo.project.name === "mobile") {
    await expect(page.getByTestId("shell-title")).toHaveText("Nouvelle carte");
    await page.getByTestId("shell-back").click();
  } else {
    const crumbs = page.getByRole("navigation", { name: "Fil d’Ariane" });
    await expect(crumbs.getByText("Nouvelle carte")).toHaveAttribute("aria-current", "page");
    await crumbs.getByRole("link", { name: "Mes cartes" }).click();
  }
  await expect(page).toHaveURL(/\/dashboard$/);
});
