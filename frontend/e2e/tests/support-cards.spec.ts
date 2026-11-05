import { expect, openCardMenu, test } from "../fixtures";

const UNAVAILABLE_TITLE = "Cette carte n’est pas disponible";

test("ADM-006 ADM-013 admin browses a user's cards, even disabled", async ({ page, api, loginAs }) => {
  await api.seed("cards");
  await loginAs("seed-admin");
  await page.goto("/support");
  await page.getByTestId("tab-approved").click();
  await page.getByTestId("user-link-seed-alice").click();

  await expect(page).toHaveURL(/\/support\/users\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("support-user-name")).toHaveText("Alice Durand");
  await expect(page.getByTestId("support-user-email")).toHaveText("alice@example.test");
  await expect(page.getByTestId("support-user-status")).toHaveText("Validé");
  await expect(page.getByTestId("support-card-row-alice-durand")).toBeVisible();
  await expect(page.getByTestId("support-card-row-alice-archive")).toBeVisible();
  await expect(page.getByTestId("card-status-alice-archive")).toHaveText("Désactivée");

  // A card disabled by its owner opens all the same, as the template shows it.
  await page.getByTestId("support-card-view-alice-archive").click();
  await expect(page).toHaveURL(/\/support\/cards\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("phone-preview").getByTestId("card-job-title")).toHaveText("Ancien poste");
  await expect(page.getByTestId("phone-preview").getByTestId("card-name")).toHaveText("Alice Durand");
  // ADM-012: nothing to edit.
  await expect(page.locator("input, textarea, select")).toHaveCount(0);
});

test("ADM-009 LNK-010 LNK-011 admin disables a card", async ({ page, api, loginAs }) => {
  const { cards } = await api.seed("cards");
  const card = cards.find((c) => c.slug === "alice-durand");
  expect(card).toBeDefined();
  await loginAs("seed-admin");
  await page.goto(`/support/cards/${card!.id}`);

  await expect(page.getByTestId("card-status-alice-durand")).toHaveText("Active");
  await page.getByTestId("support-card-disable").click();
  await expect(page.getByTestId("support-card-enable")).toBeVisible();
  await expect(page.getByTestId("card-status-alice-durand")).toHaveText("Désactivée par le support");

  // The public page turns neutral...
  await page.goto("/c/alice-durand");
  await expect(page.getByTestId("card-unavailable")).toContainText(UNAVAILABLE_TITLE);
  await expect(page.getByTestId("card-name")).toHaveCount(0);

  // ...and the owner sees the block, with no way to lift it.
  await loginAs("seed-alice");
  await page.goto("/dashboard");
  await expect(page.getByTestId("card-status-alice-durand")).toHaveText("Désactivée par le support");
  await expect(page.getByTestId("card-support-alice-durand")).toHaveText("Contacter le support");
  await openCardMenu(page, "alice-durand");
  await expect(page.getByTestId("card-enable-alice-durand")).toHaveCount(0);
});

test("ADM-010 admin lifts the block", async ({ page, api, loginAs }) => {
  await api.seed("cards");
  await loginAs("seed-admin");
  await page.goto("/support");
  await page.getByTestId("tab-approved").click();
  await page.getByTestId("user-link-seed-bob").click();
  await page.getByTestId("support-card-view-bob-martin").click();

  await expect(page.getByTestId("card-status-bob-martin")).toHaveText("Désactivée par le support");
  await page.getByTestId("support-card-enable").click();
  await expect(page.getByTestId("support-card-disable")).toBeVisible();
  await expect(page.getByTestId("card-status-bob-martin")).toHaveText("Active");

  await page.goto("/c/bob-martin");
  await expect(page.getByTestId("card-name")).toHaveText("Bob Martin");
});

test("ADM-001 non-admin cannot open support card pages", async ({ page, api, loginAs }) => {
  const adminHeaders = await api.authHeaders("seed-admin");
  const listing = await api.get("/api/admin/users?status=approved", { headers: adminHeaders });
  expect(listing.ok()).toBeTruthy();
  const { users } = (await listing.json()) as { users: { id: string; subject: string }[] };
  const alice = users.find((user) => user.subject === "seed-alice");
  expect(alice).toBeDefined();
  const { cards } = await api.seed("cards");

  await loginAs("seed-alice");
  await page.goto(`/support/users/${alice!.id}`);
  await expect(page.getByTestId("support-forbidden")).toHaveText("Accès réservé");
  await expect(page.getByTestId("support-card-row-alice-durand")).toHaveCount(0);

  await page.goto(`/support/cards/${cards[0]!.id}`);
  await expect(page.getByTestId("support-forbidden")).toHaveText("Accès réservé");
  await expect(page.getByTestId("phone-preview")).toHaveCount(0);
});

test("ADM-006 unknown ids show a not-found message", async ({ page, loginAs }) => {
  await loginAs("seed-admin");
  await page.goto("/support/users/00000000-0000-7000-8000-000000000000");
  await expect(page.getByTestId("support-not-found")).toHaveText("Utilisateur introuvable");
  await page.goto("/support/cards/00000000-0000-7000-8000-000000000000");
  await expect(page.getByTestId("support-not-found")).toHaveText("Carte introuvable");
});
