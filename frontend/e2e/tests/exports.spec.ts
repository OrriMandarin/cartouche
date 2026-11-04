import { downloadedBytes, downloadedText, expect, test } from "../fixtures";
import type { Page } from "@playwright/test";

const MARIAGE = "Salon du Mariage Clermont 2027";
const PARIS_2026 = "Salon de Paris 2026";
const BOM = [0xef, 0xbb, 0xbf];

let aliceCardId: string;
let archiveCardId: string;
let mariageId: string;

// The events scenario freezes the API clock at T0 before seeding: sign in only afterwards.
test.beforeEach(async ({ api, loginAs }) => {
  const { cards, events } = await api.seedEvents();
  const alice = cards.find((c) => c.slug === "alice-durand");
  const archive = cards.find((c) => c.slug === "alice-archive");
  const mariage = events.find((event) => event.title === MARIAGE);
  if (!alice || !archive || !mariage) throw new Error("the events scenario lacks a card or an event the export tests need");
  aliceCardId = alice.id;
  archiveCardId = archive.id;
  mariageId = mariage.id;
  await loginAs("seed-alice");
});

const eventLeadsUrl = () => `/dashboard/cards/${aliceCardId}/events/${mariageId}/leads`;
const cardLeadsUrl = (cardId = aliceCardId) => `/dashboard/cards/${cardId}/leads`;

/** Opens the export dialog, picks the options and downloads the file. */
async function exportFile(page: Page, options: { format?: "csv" | "xlsx" | "json"; includeSpam?: boolean } = {}) {
  await page.getByTestId("export-open").click();
  await page.getByTestId(`export-format-${options.format ?? "csv"}`).check();
  if (options.includeSpam) await page.getByTestId("export-include-spam").check();
  const downloading = page.waitForEvent("download");
  await page.getByTestId("export-download").click();
  const download = await downloading;
  await expect(page.getByRole("dialog")).toHaveCount(0);
  return download;
}

/** The lines of a CSV file, the byte order mark removed. */
function csvLines(text: string): string[] {
  return text.replace(/^﻿/, "").split("\r\n").filter((line) => line !== "");
}

const MARIAGE_HEADER =
  "Prénom,Nom,Email,Téléphone,Rue,Code postal,Ville,Pays,Date du mariage,Nombre d'invités,Formule,Recevoir la brochure,Événement,Date d'envoi (Europe/Paris),Date du consentement (Europe/Paris),Texte du consentement,Spam";

test("LEA-001 LEA-013 whole-card view", async ({ page, api }) => {
  await page.goto(`/dashboard/cards/${aliceCardId}/events`);
  await page.getByTestId("card-leads-link").click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/cards/${aliceCardId}/leads$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contacts — toute la carte");

  const leads = await api.cardLeads("seed-alice", aliceCardId);
  expect(leads.map((lead) => lead.answers.first_name)).toEqual(["Bot", "Zoé", "Éloïse", "Jean-Michel"]);
  // Newest first, each with the title of its event.
  expect(await page.getByTestId(/^lead-row-/).evaluateAll((rows) => rows.map((row) => row.dataset.testid))).toEqual(
    leads.map((lead) => `lead-row-${lead.id}`),
  );
  const events = [MARIAGE, MARIAGE, MARIAGE, PARIS_2026];
  for (const [index, lead] of leads.entries()) {
    await expect(page.getByTestId(`lead-event-${lead.id}`)).toHaveText(events[index]!);
  }

  await page.getByLabel("Rechercher un contact").fill("hebert");
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(1);
  await expect(page.getByTestId(/^lead-name-/)).toHaveText("Jean-Michel Hébert");

  await page.getByTestId("leads-back").click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/cards/${aliceCardId}/events$`));
});

test("LEA-006 LEA-007 LEA-022 LEA-023 event CSV", async ({ page }) => {
  await page.goto(eventLeadsUrl());
  const download = await exportFile(page);
  expect(download.suggestedFilename()).toBe("contacts-alice-durand-salon-du-mariage-clermont-2027-2027-03-15.csv");

  const bytes = await downloadedBytes(download);
  expect([...bytes.subarray(0, 3)]).toEqual(BOM);
  const lines = csvLines(await downloadedText(download));
  expect(lines[0]).toBe(MARIAGE_HEADER);
  // Oldest first, spam left out.
  expect(lines).toHaveLength(3);
  expect(lines[1]).toMatch(
    /^Éloïse,D’Aubigné-Müller,eloise@example\.test,\+33612345678,,,,,2027-09-18,120,Prestige,Oui,Salon du Mariage Clermont 2027,2027-03-15 09:30:00,/,
  );
  expect(lines[2]).toMatch(/^Zoé,Lefèvre ✨,zoe@example\.test,,,,,,,,,Non,Salon du Mariage Clermont 2027,2027-03-15 10:00:00,/);
  expect(lines.join("\n")).not.toContain("Bot");
});

test("LEA-012 spam leads only when asked", async ({ page }) => {
  await page.goto(eventLeadsUrl());
  const download = await exportFile(page, { includeSpam: true });
  const lines = csvLines(await downloadedText(download));
  expect(lines).toHaveLength(4);
  const spam = lines[0]!.split(",").indexOf("Spam");
  expect(lines[3]).toMatch(/^Bot,Spam,bot@example\.test,/);
  expect(lines[3]!.endsWith(",Oui")).toBe(true);
  expect(lines[1]!.endsWith(",Non")).toBe(true);
  expect(spam).toBe(lines[0]!.split(",").length - 1);
});

test("LEA-008 LEA-009 XLSX and JSON", async ({ page }) => {
  await page.goto(eventLeadsUrl());
  const xlsx = await exportFile(page, { format: "xlsx" });
  expect(xlsx.suggestedFilename()).toBe("contacts-alice-durand-salon-du-mariage-clermont-2027-2027-03-15.xlsx");
  expect((await downloadedBytes(xlsx)).subarray(0, 2).toString("latin1")).toBe("PK");

  const json = await exportFile(page, { format: "json" });
  expect(json.suggestedFilename()).toBe("contacts-alice-durand-salon-du-mariage-clermont-2027-2027-03-15.json");
  const body = JSON.parse(await downloadedText(json)) as {
    event: { title: string };
    leads: {
      submitted_at: string;
      standard: { first_name: string | null };
      custom: { label: string; value: unknown }[];
    }[];
  };
  expect(body.event.title).toBe(MARIAGE);
  expect(body.leads).toHaveLength(2);
  const eloise = body.leads.find((lead) => lead.standard.first_name === "Éloïse");
  expect(eloise?.submitted_at.endsWith("Z")).toBe(true);
  expect(eloise?.custom.find((answer) => answer.label === "Nombre d'invités")?.value).toBe(120);
  expect(eloise?.custom.find((answer) => answer.label === "Recevoir la brochure")?.value).toBe(true);
});

test("LEA-011 LEA-024 FRM-023 card export keeps the deleted field", async ({ page }) => {
  await page.goto(cardLeadsUrl());
  const download = await exportFile(page);
  expect(download.suggestedFilename()).toBe("contacts-alice-durand-2027-03-15.csv");
  const lines = csvLines(await downloadedText(download));
  expect(lines[0]).toContain("Entreprise");
  // Oldest first: Jean-Michel, then Éloïse and Zoé.
  expect(lines).toHaveLength(4);
  expect(lines[1]).toContain("Hébert & Fils");
  expect(lines[1]).toMatch(/^Jean-Michel,Hébert,jean-michel@example\.test,/);
});

test("LEA-005 a deleted lead is not exported", async ({ page, api }) => {
  const zoe = (await api.leads("seed-alice", mariageId)).find((lead) => lead.answers.first_name === "Zoé");
  if (!zoe) throw new Error("no seeded contact named Zoé");
  await page.goto(eventLeadsUrl());
  await page.getByTestId(`lead-delete-${zoe.id}`).click();
  await page.getByTestId("lead-delete-confirm").click();
  await expect(page.getByTestId(`lead-row-${zoe.id}`)).toHaveCount(0);

  const download = await exportFile(page, { includeSpam: true });
  const text = await downloadedText(download);
  expect(csvLines(text)).toHaveLength(3);
  expect(text).not.toContain("Zoé");
  expect(text).toContain("Éloïse");
});

test("LNK-008 LEA-031 a disabled card with no lead exports its header row", async ({ page }) => {
  await page.goto(cardLeadsUrl(archiveCardId));
  await expect(page.getByTestId("leads-empty")).toBeVisible();
  const download = await exportFile(page);
  expect(download.suggestedFilename()).toBe("contacts-alice-archive-2027-03-15.csv");
  const bytes = await downloadedBytes(download);
  expect([...bytes.subarray(0, 3)]).toEqual(BOM);
  const lines = csvLines(await downloadedText(download));
  expect(lines).toEqual(["Email,Événement,Date d'envoi (Europe/Paris),Date du consentement (Europe/Paris),Texte du consentement,Spam"]);
});

test("LEA-021 the export is not filtered by the search", async ({ page }) => {
  await page.goto(cardLeadsUrl());
  await page.getByLabel("Rechercher un contact").fill("hebert");
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(1);
  const download = await exportFile(page);
  expect(csvLines(await downloadedText(download))).toHaveLength(4);
});
