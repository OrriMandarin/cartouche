import { expect, test } from "../fixtures";

const MARIAGE = "Salon du Mariage Clermont 2027";
const PARIS_2026 = "Salon de Paris 2026";
const NOTICE = "Consultation en lecture seule, enregistrée dans le journal d'audit";

let aliceCardId: string;
let mariageId: string;

// The events scenario freezes the API clock at T0 before seeding: sign in only afterwards.
test.beforeEach(async ({ api }) => {
  const { cards, events } = await api.seedEvents();
  const card = cards.find((c) => c.slug === "alice-durand");
  const mariage = events.find((event) => event.title === MARIAGE);
  if (!card || !mariage) throw new Error("the events scenario lacks a card or an event the support tests need");
  aliceCardId = card.id;
  mariageId = mariage.id;
});

test("ADM-007 ADM-016 support sees a user's events", async ({ page, loginAs }) => {
  await loginAs("seed-admin");
  await page.goto("/support");
  await page.getByTestId("tab-approved").click();
  await page.getByTestId("user-link-seed-alice").click();
  await page.getByTestId("support-card-events-alice-durand").click();

  await expect(page).toHaveURL(new RegExp(`/support/cards/${aliceCardId}/events$`));
  const row = page.getByTestId(`support-event-row-${mariageId}`);
  await expect(row).toContainText(MARIAGE);
  await expect(row).toContainText("3 contacts");
  await expect(row).toContainText("En cours");
  // Read-only: nothing to create, edit, end or delete.
  await expect(row.getByRole("button")).toHaveCount(0);
  await expect(page.getByText("Modifier", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Nouvel événement")).toHaveCount(0);

  await page.getByTestId("support-back").click();
  await expect(page).toHaveURL(new RegExp(`/support/cards/${aliceCardId}$`));
});

test("ADM-007 ADM-017 ADM-018 support reads leads read-only", async ({ page, api, loginAs }) => {
  const consent = (await api.leads("seed-alice", mariageId)).find((lead) => lead.answers.first_name === "Zoé")?.consent_text;
  if (!consent) throw new Error("the seeded contact has no consent text");
  await loginAs("seed-admin");
  await page.goto(`/support/cards/${aliceCardId}/events`);
  await page.getByTestId(`support-event-leads-${mariageId}`).click();

  await expect(page).toHaveURL(new RegExp(`/support/cards/${aliceCardId}/events/${mariageId}/leads$`));
  await expect(page.getByTestId("support-leads-notice")).toHaveText(NOTICE);
  await expect(page.getByTestId("support-leads-subtitle")).toHaveText(MARIAGE);
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(3);

  await page.getByLabel("Rechercher un contact").fill("zoe");
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(1);
  await expect(page.getByTestId(/^lead-name-/)).toHaveText("Zoé Lefèvre ✨");

  await page.getByTestId(/^lead-open-/).click();
  await expect(page.getByTestId("lead-detail")).toContainText("Zoé Lefèvre ✨");
  await expect(page.getByTestId("lead-detail-consent")).toContainText(consent);
  await expect(page.getByTestId("lead-detail-spam")).toHaveCount(0);
  await expect(page.getByTestId("lead-detail-delete")).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "Fermer" }).click();

  // ADM-018: no spam mark, deletion or export, in the list or beside it.
  await expect(page.getByTestId(/^lead-spam-/)).toHaveCount(0);
  await expect(page.getByTestId(/^lead-delete-/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Exporter|Supprimer|Marquer comme spam)/ })).toHaveCount(0);
  await expect(page.getByTestId("export-open")).toHaveCount(0);
});

test("ADM-016 LEA-013 support whole-card view", async ({ page, loginAs }) => {
  await loginAs("seed-admin");
  await page.goto(`/support/cards/${aliceCardId}/events`);
  await page.getByTestId("support-card-leads").click();

  await expect(page).toHaveURL(new RegExp(`/support/cards/${aliceCardId}/leads$`));
  await expect(page.getByTestId("support-leads-notice")).toHaveText(NOTICE);
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(4);
  const titles = await page.getByTestId(/^lead-event-/).allTextContents();
  expect(titles.filter((title) => title === MARIAGE)).toHaveLength(3);
  expect(titles.filter((title) => title === PARIS_2026)).toHaveLength(1);
  await expect(page.getByTestId("export-open")).toHaveCount(0);

  await page.getByTestId("support-back").click();
  await expect(page).toHaveURL(new RegExp(`/support/cards/${aliceCardId}/events$`));
});

test("ADM-001 the support lead pages are for administrators only", async ({ page, loginAs }) => {
  await loginAs("seed-alice");
  for (const path of [
    `/support/cards/${aliceCardId}/events`,
    `/support/cards/${aliceCardId}/leads`,
    `/support/cards/${aliceCardId}/events/${mariageId}/leads`,
  ]) {
    await page.goto(path);
    await expect(page.getByTestId("support-forbidden")).toHaveText("Accès réservé");
    await expect(page.getByTestId(/^lead-row-/)).toHaveCount(0);
  }
});
