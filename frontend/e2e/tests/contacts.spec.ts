import { downloadedText, expect, test } from "../fixtures";

const MARIAGE = "Salon du Mariage Clermont 2027";

let aliceCardId: string;
let archiveCardId: string;
let mariageId: string;

// The events scenario freezes the API clock at T0 before seeding: sign in only afterwards.
test.beforeEach(async ({ api, loginAs }) => {
  const { cards, events } = await api.seedEvents();
  const card = cards.find((c) => c.slug === "alice-durand");
  const archive = cards.find((c) => c.slug === "alice-archive");
  const mariage = events.find((event) => event.title === MARIAGE);
  if (!card || !archive || !mariage) throw new Error("the events scenario lacks the card or the event the contacts tests need");
  aliceCardId = card.id;
  archiveCardId = archive.id;
  mariageId = mariage.id;
  await loginAs("seed-alice");
});

test("EDI-031 LEA-034 LEA-035 contacts of Alice", async ({ page, api }, testInfo) => {
  const phone = testInfo.project.name === "mobile";
  await page.goto("/dashboard/contacts");

  // The first card by default, the whole card: 4 contacts, one of them spam.
  await expect(page.getByTestId("contacts-card-select")).toHaveText("Carte : alice-durand");
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(4);
  await expect(page.getByTestId("leads-count")).toHaveText("4 contacts, dont 1 marqué comme spam");

  // The scope: an event, chosen with a tab on a computer and with a menu on a phone.
  if (phone) {
    await page.getByTestId("contacts-scope-select").click();
    await page.getByTestId(`contacts-scope-option-${mariageId}`).click();
  } else {
    await expect(page.getByTestId("contacts-scope-tab-all")).toContainText("4");
    await page.getByTestId(`contacts-scope-tab-${mariageId}`).click();
  }
  await expect(page).toHaveURL(new RegExp(`event=${mariageId}`));
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(3);
  await expect(page.getByTestId("leads-count")).toHaveText("3 contacts, dont 1 marqué comme spam");
  if (phone) {
    await page.getByTestId("contacts-scope-select").click();
    await page.getByTestId("contacts-scope-option-all").click();
  } else {
    await page.getByTestId("contacts-scope-tab-all").click();
  }
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(4);

  // The export announces the exact count: the spam contact is left out until it is included.
  await page.getByTestId(phone ? "export-open-bar" : "export-open").click();
  await expect(page.getByTestId("export-scope")).toHaveText("Carte alice-durand · Toute la carte · 4 contacts");
  await expect(page.getByTestId("export-download")).toHaveText("Exporter 3 contacts");
  await page.getByTestId("export-include-spam").check();
  await expect(page.getByTestId("export-download")).toHaveText("Exporter 4 contacts");
  const downloading = page.waitForEvent("download");
  await page.getByTestId("export-download").click();
  const lines = (await downloadedText(await downloading)).replace(/^﻿/, "").trim().split(/\r?\n/);
  expect(lines).toHaveLength(5);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Marking a contact as spam is announced, and the toast's « Annuler » undoes it.
  const zoe = (await api.leads("seed-alice", mariageId)).find((lead) => lead.answers.first_name === "Zoé");
  if (!zoe) throw new Error("no seeded contact named Zoé");
  await page.getByTestId(`lead-open-${zoe.id}`).click();
  await page.getByTestId("lead-detail-spam").click();
  await expect(page.getByTestId(`lead-spam-badge-${zoe.id}`)).toHaveText("Spam");
  const toast = page.getByText("Contact marqué comme spam");
  await expect(toast).toBeVisible();
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByTestId(`lead-spam-badge-${zoe.id}`)).toHaveCount(0);
  await expect(page.getByTestId("leads-count")).toHaveText("4 contacts, dont 1 marqué comme spam");
  expect((await api.leads("seed-alice", mariageId)).find((lead) => lead.id === zoe.id)?.spam).toBe(false);
});

test("EDI-031 a card without contact says so and leads to its events", async ({ page }) => {
  await page.goto(`/dashboard/contacts?card=${archiveCardId}`);
  await expect(page.getByTestId("contacts-card-select")).toHaveText("Carte : alice-archive");
  await expect(page.getByTestId("leads-empty")).toContainText("Aucun contact pour l’instant");
  await page.getByTestId("contacts-events-link").click();
  await expect(page).toHaveURL(/\/dashboard\/cards\/[^/]+\/events$/);
});
