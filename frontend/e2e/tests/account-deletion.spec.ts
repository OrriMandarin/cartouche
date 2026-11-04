import { expect, test, type TestApi } from "../fixtures";

const NEUTRAL_TEXT = "Cette carte n'est plus active";
const STATUSES = ["pending", "approved", "rejected", "suspended"];

/** Deletes an account through the API, as its owner. */
async function deleteAccount(api: TestApi, subject: string) {
  const response = await api.delete("/api/me", { headers: await api.authHeaders(subject) });
  expect(response.status()).toBe(204);
}

/** The subjects of every account the administrator can list, whatever its status. */
async function accountSubjects(api: TestApi): Promise<string[]> {
  const headers = await api.authHeaders("seed-admin");
  const subjects: string[] = [];
  for (const status of STATUSES) {
    const response = await api.get(`/api/admin/users?status=${status}`, { headers });
    expect(response.ok()).toBeTruthy();
    const { users } = (await response.json()) as { users: { subject: string }[] };
    subjects.push(...users.map((user) => user.subject));
  }
  return subjects;
}

test("ACC-019 ACC-020 ACC-022 LNK-015 LNK-033 a user deletes their account", async ({ page, api, loginAs }) => {
  const { cards } = await api.seed("cards");
  const bobCard = cards.find((card) => card.owner === "seed-bob");
  expect(bobCard).toBeDefined();

  // Bob's card is disabled by support in the seed: lift the block, so that the deletion is what makes it neutral.
  const lifted = await api.post(`/api/admin/cards/${bobCard!.id}/support-enable`, {
    headers: await api.authHeaders("seed-admin"),
  });
  expect(lifted.ok()).toBeTruthy();
  await page.goto("/c/bob-martin");
  await expect(page.getByTestId("card-name")).toHaveText("Bob Martin");

  await loginAs("seed-bob");
  await page.goto("/dashboard");
  await page.getByTestId("account-link").click();
  await expect(page).toHaveURL(/\/dashboard\/account$/);
  await expect(page.getByTestId("account-email")).toHaveText("bob@example.test");

  await page.getByTestId("delete-account-open").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("supprimés pour toujours");
  await expect(dialog).toContainText("bloqués définitivement");
  await expect(dialog).toContainText("ne sera pas supprimé");
  await expect(page.getByTestId("delete-account-confirm")).toBeDisabled();
  await page.getByTestId("delete-account-input").fill(" supprimer ");
  await expect(page.getByTestId("delete-account-confirm")).toBeEnabled();
  await page.getByTestId("delete-account-confirm").click();

  await expect(page).toHaveURL(/\/account-deleted$/);
  await expect(page.getByTestId("account-deleted")).toContainText("Ton compte a été supprimé");

  // Only public pages from here on: an (app) page would recreate an empty account for Bob (ACC-023).
  await page.goto("/c/bob-martin");
  await expect(page.getByText(NEUTRAL_TEXT)).toBeVisible();
  await expect(page.getByTestId("card-name")).toHaveCount(0);
  expect(await accountSubjects(api)).not.toContain("seed-bob");
});

test("LNK-032 a blocked slug cannot be taken by anyone", async ({ page, api, loginAs }) => {
  await api.seed("cards");
  await deleteAccount(api, "seed-bob");

  await loginAs("seed-alice");
  await page.goto("/dashboard/cards/new");

  // The suggestion skips the blocked slug (LNK-019)...
  await page.getByTestId("new-card-first-name").fill("Bob");
  await page.getByTestId("new-card-last-name").fill("Martin");
  await expect(page.getByTestId("slug-input")).toHaveValue("bob-martin-2");
  await expect(page.getByTestId("slug-status")).toHaveText("Disponible");

  // ...the availability check says it is taken (LNK-020)...
  await page.getByTestId("slug-input").fill("bob-martin");
  await expect(page.getByTestId("slug-status")).toHaveText("Déjà pris");
  await expect(page.getByTestId("new-card-submit")).toBeDisabled();

  // ...and the API refuses the claim (LNK-022).
  const refused = await api.post("/api/cards", {
    headers: await api.authHeaders("seed-alice"),
    data: { first_name: "Bob", last_name: "Martin", slug: "bob-martin" },
  });
  expect(refused.status()).toBe(409);
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("slug_taken");
});

test("ACC-023 signing in again gives a new pending account", async ({ page, api, loginAs }) => {
  await api.seed("cards");
  await deleteAccount(api, "seed-bob");

  await loginAs("seed-bob");
  await page.goto("/dashboard");
  await expect(page.getByTestId("account-pending")).toContainText("Ton compte est en attente de validation");

  // The new account is a different one, with no card: Bob's old card did not come back with him.
  const headers = await api.authHeaders("seed-admin");
  const listing = await api.get("/api/admin/users?status=pending", { headers });
  const { users } = (await listing.json()) as { users: { id: string; subject: string }[] };
  const bob = users.find((user) => user.subject === "seed-bob");
  expect(bob).toBeDefined();
  const detail = await api.get(`/api/admin/users/${bob!.id}`, { headers });
  expect(detail.ok()).toBeTruthy();
  expect(((await detail.json()) as { cards: unknown[] }).cards).toEqual([]);
});

test("ACC-021 a pending account can delete itself", async ({ page, api, loginAs }) => {
  await loginAs("seed-carol");
  await page.goto("/dashboard");
  await expect(page.getByTestId("account-pending")).toBeVisible();

  await page.getByTestId("delete-account-open").click();
  await page.getByTestId("delete-account-input").fill("SUPPRIMER");
  await page.getByTestId("delete-account-confirm").click();

  await expect(page).toHaveURL(/\/account-deleted$/);
  await expect(page.getByTestId("account-deleted")).toBeVisible();
  expect(await accountSubjects(api)).not.toContain("seed-carol");
});

test("ACC-021 an administrator cannot delete their account", async ({ page, loginAs }) => {
  await loginAs("seed-admin");
  await page.goto("/dashboard");
  await page.getByTestId("account-link").click();
  await expect(page).toHaveURL(/\/dashboard\/account$/);
  await expect(page.getByTestId("delete-account-admin")).toContainText("ADMIN_USER_IDS");
  await expect(page.getByTestId("delete-account-open")).toHaveCount(0);
});
