import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

let aliceCardId: string;
let archiveCardId: string;
let eventIds: Record<string, string>;

const MARIAGE = "Salon du Mariage Clermont 2027";
const PORTES = "Portes ouvertes de l'Atelier";
const DEMO = "Démonstration en boutique";
const DECOUVERTE = "Atelier découverte";
const LYON = "Foire de Lyon";
const PARIS = "Salon de Paris 2026";

// The events scenario freezes the API clock at T0 before seeding: sign in only afterwards.
test.beforeEach(async ({ api, loginAs }) => {
  const { cards, events } = await api.seedEvents();
  const cardId = (slug: string) => {
    const card = cards.find((c) => c.slug === slug);
    if (!card) throw new Error(`the scenario has no ${slug} card`);
    return card.id;
  };
  aliceCardId = cardId("alice-durand");
  archiveCardId = cardId("alice-archive");
  eventIds = Object.fromEntries(events.map((event) => [event.title, event.id]));
  await loginAs("seed-alice");
});

/** The event button of the public page of alice-durand for that event (PUB-029). */
async function eventButton(page: Page, eventId: string) {
  await page.goto("/c/alice-durand");
  await expect(page.getByTestId("card-name")).toHaveText("Alice Durand");
  return page.getByTestId(`event-button-${eventId}`);
}

const eventsUrl = () => `/dashboard/cards/${aliceCardId}/events`;
const idOf = (title: string) => {
  const id = eventIds[title];
  if (!id) throw new Error(`no seeded event "${title}"`);
  return id;
};

test("EDI-009 EDI-018 EVT-020 the events of a card in three groups", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByTestId("card-events-alice-durand").click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/cards/${aliceCardId}/events$`));

  const running = page.getByTestId("events-group-running");
  const upcoming = page.getByTestId("events-group-upcoming");
  const past = page.getByTestId("events-group-past");
  await expect(running.getByTestId(`event-title-${idOf(MARIAGE)}`)).toHaveText(MARIAGE);
  await expect(running.getByTestId(`event-title-${idOf(PORTES)}`)).toHaveText(PORTES);
  await expect(running.getByTestId(`event-title-${idOf(DEMO)}`)).toHaveText(DEMO);
  await expect(upcoming.getByTestId(`event-title-${idOf(LYON)}`)).toHaveText(LYON);
  // Ended ten minutes ago: past, although it still takes submissions for a quarter of an hour (EVT-008).
  await expect(past.getByTestId(`event-title-${idOf(DECOUVERTE)}`)).toHaveText(DECOUVERTE);
  await expect(past.getByTestId(`event-title-${idOf(PARIS)}`)).toHaveText(PARIS);
  await expect(page.getByTestId(/^event-row-/)).toHaveCount(6);

  const mariage = idOf(MARIAGE);
  await expect(page.getByTestId(`event-lead-count-${mariage}`)).toHaveText("3 contacts");
  await expect(page.getByTestId(`event-start-${mariage}`)).toContainText("15 mars 2027 à 09:00");
  await expect(page.getByTestId(`event-phase-${mariage}`)).toHaveText("En cours");
  await expect(page.getByTestId(`event-end-${idOf(PORTES)}`)).toHaveText("Sans fin");
  await expect(page.getByTestId(`event-phase-${idOf(LYON)}`)).toHaveText("À venir");
  await expect(page.getByTestId(`event-phase-${idOf(PARIS)}`)).toHaveText("Passé");
  // Only a running event can be ended now.
  await expect(page.getByTestId(`event-end-now-${mariage}`)).toBeVisible();
  await expect(page.getByTestId(`event-end-now-${idOf(LYON)}`)).toHaveCount(0);
  await expect(page.getByTestId(`event-end-now-${idOf(PARIS)}`)).toHaveCount(0);
});

test("EDI-018 the events are also one click away from the editor of the card", async ({ page }) => {
  await page.goto(`/dashboard/cards/${aliceCardId}`);
  await page.getByTestId("editor-events").click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/cards/${aliceCardId}/events$`));
  await expect(page.getByTestId("events-group-running")).toBeVisible();
});

test("EVT-001 EVT-007 EVT-022 create an event in the user's time zone", async ({ page, api }) => {
  await page.goto(eventsUrl());
  await page.getByTestId("new-event").click();
  await expect(page).toHaveURL(/\/events\/new$/);
  await expect(page.getByTestId("event-zone")).toContainText("Europe/Paris");

  await page.getByTestId("event-title").fill("Foire d’Automne ✨");
  await page.getByTestId("event-starts-at").fill("2027-04-02T10:00");
  await page.getByTestId("event-no-end").click();
  await page.getByTestId("event-ends-at").fill("2027-04-02T18:00");
  await page.getByTestId("event-save").click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/cards/${aliceCardId}/events$`));
  const row = page.getByTestId("events-group-upcoming").getByTestId(/^event-row-/).filter({ hasText: "Foire d’Automne ✨" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("2 avril 2027 à 10:00");

  const response = await api.get(`/api/cards/${aliceCardId}/events`, { headers: await api.authHeaders("seed-alice") });
  const { events } = (await response.json()) as { events: { title: string; starts_at: string; ends_at: string }[] };
  const created = events.find((event) => event.title === "Foire d’Automne ✨");
  expect(created?.starts_at).toBe("2027-04-02T08:00:00Z");
  expect(created?.ends_at).toBe("2027-04-02T16:00:00Z");
});

test("EVT-004 EVT-018 a fourth simultaneous event is refused", async ({ page, api }) => {
  await page.goto(`${eventsUrl()}/new`);
  await page.getByTestId("event-title").fill("Quatrième événement");
  // 10:00 to 11:00 UTC: the three running events are all still on.
  await page.getByTestId("event-starts-at").fill("2027-03-15T11:00");
  await page.getByTestId("event-no-end").click();
  await page.getByTestId("event-ends-at").fill("2027-03-15T12:00");
  await page.getByTestId("event-save").click();

  await expect(page.getByTestId("event-conflict")).toContainText("maximum d'événements en même temps");
  await expect(page).toHaveURL(/\/events\/new$/);
  await expect(page.getByTestId("event-title")).toHaveValue("Quatrième événement");
  await expect(page.getByTestId("event-save")).toBeEnabled();

  const response = await api.get(`/api/cards/${aliceCardId}/events`, { headers: await api.authHeaders("seed-alice") });
  expect(((await response.json()) as { events: unknown[] }).events).toHaveLength(6);
});

test("EVT-006 EVT-021 PUB-029 end an event now", async ({ page }) => {
  const demo = idOf(DEMO);
  await expect(await eventButton(page, demo)).toHaveText(DEMO);

  await page.goto(eventsUrl());
  await page.getByTestId(`event-end-now-${demo}`).click();
  await expect(page.getByTestId("events-group-past").getByTestId(`event-row-${demo}`)).toBeVisible();
  await expect(page.getByTestId("events-group-running").getByTestId(`event-row-${demo}`)).toHaveCount(0);
  await expect(page.getByTestId(`event-end-now-${demo}`)).toHaveCount(0);

  await expect(await eventButton(page, demo)).toHaveCount(0);
  await expect(page.getByTestId(`event-button-${idOf(MARIAGE)}`)).toHaveText(MARIAGE);
});

test("EVT-009 EVT-010 EDI-019 edit an event", async ({ page }) => {
  const portes = idOf(PORTES);
  await page.goto(eventsUrl());
  await page.getByTestId(`event-edit-${portes}`).click();
  await expect(page).toHaveURL(new RegExp(`/events/${portes}$`));
  await expect(page.getByTestId("event-title")).toHaveValue(PORTES);
  // The access code is shown in clear to its owner.
  await expect(page.getByTestId("event-access-code")).toHaveValue("Château");
  await expect(page.getByTestId("event-starts-at")).toHaveValue("2027-03-15T10:00");
  await expect(page.getByTestId("event-no-end")).toBeChecked();
  // The consent text of the event is its own.
  await expect(page.getByTestId("consent-mode")).toContainText("Texte personnalisé");
  await expect(page.getByTestId("consent-text")).toHaveValue(/Atelier Durand & Fils/);

  await page.getByTestId("event-title").fill("Portes ouvertes ✨");
  await page.getByTestId("event-save").click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/cards/${aliceCardId}/events$`));
  await expect(page.getByTestId(`event-title-${portes}`)).toHaveText("Portes ouvertes ✨");

  await expect(await eventButton(page, portes)).toHaveText("Portes ouvertes ✨");
});

test("EDI-021 leaving the event editor with unsaved changes asks first", async ({ page }) => {
  const mariage = idOf(MARIAGE);
  await page.goto(`${eventsUrl()}/${mariage}`);
  await expect(page.getByTestId("event-title")).toHaveValue(MARIAGE);
  await page.getByTestId("event-title").fill(`${MARIAGE} ✨`);

  // A link of the editor, then the « Mon compte » link of the page header: both ask, and a refusal stays here.
  const asked: string[] = [];
  page.on("dialog", (dialog) => {
    asked.push(dialog.type());
    void dialog.dismiss();
  });
  for (const link of ["event-back", "account-link"]) {
    await page.getByTestId(link).click();
    await expect(page).toHaveURL(new RegExp(`/events/${mariage}$`));
    await expect(page.getByTestId("event-title")).toHaveValue(`${MARIAGE} ✨`);
  }
  expect(asked).toEqual(["confirm", "confirm"]);

  // After a successful save the redirect to the list asks nothing.
  await page.getByTestId("event-save").click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/cards/${aliceCardId}/events$`));
  await expect(page.getByTestId(`event-title-${mariage}`)).toHaveText(`${MARIAGE} ✨`);
  expect(asked).toHaveLength(2);
});

test("FRM-029 R-PF6 the default consent text is the server's, and follows the title", async ({ page }) => {
  await page.goto(`${eventsUrl()}/new`);
  await page.getByTestId("event-title").fill("Salon d’été ✨");
  await expect(page.getByTestId("consent-default-text")).toContainText("Alice Durand");
  await expect(page.getByTestId("consent-default-text")).toContainText("« Salon d’été ✨ »");
  await expect(page.getByTestId("consent-no-email")).toHaveCount(0);
});

test("FRM-029 the card without an email gets a warning next to the default consent text", async ({ page }) => {
  await page.goto(`/dashboard/cards/${archiveCardId}/events/new`);
  await expect(page.getByTestId("consent-no-email")).toBeVisible();
});

test("FRM-020 FRM-021 FRM-032 custom fields are saved in order", async ({ page, api }) => {
  const mariage = idOf(MARIAGE);
  await page.goto(`${eventsUrl()}/${mariage}`);
  await expect(page.getByTestId("custom-label-0")).toHaveValue("Date du mariage");
  await expect(page.getByTestId("custom-label-3")).toHaveValue("Recevoir la brochure");

  await page.getByTestId("custom-add-single_choice").click();
  await page.getByTestId("custom-label-4").fill("Votre budget");
  await page.getByTestId("custom-option-4-0").fill("< 5 000 €");
  await page.getByTestId("custom-option-4-1").fill("> 5 000 €");
  for (let i = 0; i < 4; i += 1) await page.getByTestId("custom-up-" + (4 - i)).click();
  await expect(page.getByTestId("custom-label-0")).toHaveValue("Votre budget");
  await page.getByTestId("event-save").click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/cards/${aliceCardId}/events$`));

  await page.reload();
  await page.getByTestId(`event-edit-${mariage}`).click();
  await expect(page.getByTestId("custom-label-0")).toHaveValue("Votre budget");
  await expect(page.getByTestId("custom-option-0-0")).toHaveValue("< 5 000 €");
  await expect(page.getByTestId("custom-option-0-1")).toHaveValue("> 5 000 €");
  await expect(page.getByTestId("custom-label-1")).toHaveValue("Date du mariage");
  await expect(page.getByTestId("custom-label-4")).toHaveValue("Recevoir la brochure");

  const response = await api.get(`/api/events/${mariage}`, { headers: await api.authHeaders("seed-alice") });
  const event = (await response.json()) as { custom_fields: { label: string }[] };
  expect(event.custom_fields.map((field) => field.label)).toEqual([
    "Votre budget",
    "Date du mariage",
    "Nombre d'invités",
    "Formule",
    "Recevoir la brochure",
  ]);
});

test("EDI-019 EDI-015 a rejected save keeps the input and shows the errors next to the fields", async ({ page }) => {
  await page.goto(`${eventsUrl()}/new`);
  await page.getByTestId("event-title").fill("Salon ✨");
  await page.getByTestId("event-starts-at").fill("2027-05-02T10:00");
  await page.getByTestId("event-no-end").click();
  await page.getByTestId("event-ends-at").fill("2027-05-02T09:00");
  await page.getByTestId("event-device-limit").fill("500");
  await page.getByTestId("custom-add-single_choice").click();
  await page.getByTestId("custom-option-0-0").fill("Poterie");
  await page.getByTestId("custom-option-0-1").fill("Poterie");
  await page.getByTestId("event-save").click();

  await expect(page.getByTestId("field-error-ends-at")).toContainText("La fin doit être après le début.");
  await expect(page.getByTestId("field-error-device-limit")).toBeVisible();
  await expect(page.getByTestId("field-error-custom-fields-0-label")).toBeVisible();
  await expect(page.getByTestId("field-error-custom-fields-0-options-1")).toContainText("déjà dans la liste");
  await expect(page.getByTestId("event-title")).toHaveValue("Salon ✨");
  await expect(page.getByTestId("event-device-limit")).toHaveValue("500");
  await expect(page.getByTestId("custom-option-0-1")).toHaveValue("Poterie");
  await expect(page).toHaveURL(/\/events\/new$/);
});

test("EVT-024 delete an event and its leads", async ({ page, api }) => {
  const paris = idOf(PARIS);
  await page.goto(eventsUrl());
  await page.getByTestId(`event-delete-${paris}`).click();
  await expect(page.getByRole("dialog")).toContainText("1 contact");
  await page.getByTestId("event-delete-cancel").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId(`event-row-${paris}`)).toBeVisible();

  await page.getByTestId(`event-delete-${paris}`).click();
  await page.getByTestId("event-delete-confirm").click();
  await expect(page.getByTestId(`event-row-${paris}`)).toHaveCount(0);
  await expect(api.leads("seed-alice", paris)).rejects.toThrow(/404/);
});

test("EVT-025 LNK-008 events of a disabled card are still listed and editable", async ({ page }) => {
  await page.goto(`/dashboard/cards/${archiveCardId}/events`);
  const archived = idOf("Événement archivé");
  await expect(page.getByTestId(`event-title-${archived}`)).toHaveText("Événement archivé");
  await page.getByTestId(`event-edit-${archived}`).click();
  await expect(page.getByTestId("event-title")).toHaveValue("Événement archivé");
});

test("ACC-017 another user's events are not reachable", async ({ page, loginAs }) => {
  await loginAs("seed-bob");
  await page.goto(eventsUrl());
  await expect(page.getByTestId("card-not-found")).toHaveText("Carte introuvable");
  await expect(page.getByTestId(/^event-row-/)).toHaveCount(0);

  await page.goto(`${eventsUrl()}/${idOf(PORTES)}`);
  await expect(page.getByTestId("card-not-found")).toHaveText("Carte introuvable");
});
