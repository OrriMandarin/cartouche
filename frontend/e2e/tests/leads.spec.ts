import { expect, test, type TestApi } from "../fixtures";

const MARIAGE = "Salon du Mariage Clermont 2027";

// Ids of the seeded wedding fields (`WEDDING_FIELDS`) and of the field deleted from Jean-Michel's contact.
const WEDDING_DATE_FIELD = "0198c8a1-0000-7000-8000-000000000001";
const WEDDING_GUESTS_FIELD = "0198c8a1-0000-7000-8000-000000000002";
const WEDDING_PLAN_FIELD = "0198c8a1-0000-7000-8000-000000000003";
const WEDDING_BROCHURE_FIELD = "0198c8a1-0000-7000-8000-000000000004";
const DELETED_COMPANY_FIELD = "0198c8a1-0000-7000-8000-000000000005";
const PARIS_2026 = "Salon de Paris 2026";

let aliceCardId: string;
let mariageId: string;
let parisId: string;

// The events scenario freezes the API clock at T0 before seeding: sign in only afterwards.
test.beforeEach(async ({ api, loginAs }) => {
  const { cards, events } = await api.seedEvents();
  const card = cards.find((c) => c.slug === "alice-durand");
  const mariage = events.find((event) => event.title === MARIAGE);
  const paris = events.find((event) => event.title === PARIS_2026);
  if (!card || !mariage || !paris) throw new Error("the events scenario lacks a card or an event the leads tests need");
  aliceCardId = card.id;
  mariageId = mariage.id;
  parisId = paris.id;
  await loginAs("seed-alice");
});

const leadsUrl = () => `/dashboard/cards/${aliceCardId}/events/${mariageId}/leads`;

/** The id of the seeded contact with that first name. */
async function leadId(api: TestApi, firstName: string): Promise<string> {
  const lead = (await api.leads("seed-alice", mariageId)).find((l) => l.answers.first_name === firstName);
  if (!lead) throw new Error(`no seeded contact named ${firstName}`);
  return lead.id;
}

test("EDI-020 FRM-016 leads of an event, accents intact", async ({ page, api }) => {
  await page.goto("/dashboard");
  await page.getByTestId("card-events-alice-durand").click();
  await page.getByTestId(`event-contacts-${mariageId}`).click();
  await expect(page).toHaveURL(new RegExp(`/events/${mariageId}/leads$`));
  await expect(page.getByTestId("leads-event-title")).toHaveText(MARIAGE);

  const bot = await leadId(api, "Bot");
  const zoe = await leadId(api, "Zoé");
  const eloise = await leadId(api, "Éloïse");
  // Newest first.
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(3);
  expect(await page.getByTestId(/^lead-row-/).evaluateAll((rows) => rows.map((row) => row.dataset.testid))).toEqual([
    `lead-row-${bot}`,
    `lead-row-${zoe}`,
    `lead-row-${eloise}`,
  ]);
  await expect(page.getByTestId(`lead-name-${bot}`)).toHaveText("Bot Spam");
  await expect(page.getByTestId(`lead-spam-badge-${bot}`)).toHaveText("Spam");
  await expect(page.getByTestId(`lead-name-${zoe}`)).toHaveText("Zoé Lefèvre ✨");
  await expect(page.getByTestId(`lead-spam-badge-${zoe}`)).toHaveCount(0);
  await expect(page.getByTestId(`lead-name-${eloise}`)).toHaveText("Éloïse D’Aubigné-Müller");
  await expect(page.getByTestId(`lead-email-${eloise}`)).toHaveText("eloise@example.test");
  await expect(page.getByTestId(`lead-phone-${eloise}`)).toHaveText("+33 6 12 34 56 78");
  await expect(page.getByTestId(`lead-date-${eloise}`)).not.toBeEmpty();
});

test("ABU-003 ABU-009 mark and unmark spam", async ({ page, api }) => {
  const zoe = await leadId(api, "Zoé");
  await page.goto(leadsUrl());
  await page.getByTestId(`lead-spam-${zoe}`).click();
  await expect(page.getByTestId(`lead-spam-badge-${zoe}`)).toHaveText("Spam");
  // Still listed, and stored.
  await expect(page.getByTestId(`lead-row-${zoe}`)).toBeVisible();

  await page.reload();
  await expect(page.getByTestId(`lead-spam-badge-${zoe}`)).toHaveText("Spam");

  await page.getByTestId(`lead-spam-${zoe}`).click();
  await expect(page.getByTestId(`lead-spam-badge-${zoe}`)).toHaveCount(0);
  await expect(page.getByTestId(`lead-spam-${zoe}`)).toHaveText("Marquer comme spam");
  await page.reload();
  await expect(page.getByTestId(`lead-row-${zoe}`)).toBeVisible();
  await expect(page.getByTestId(`lead-spam-badge-${zoe}`)).toHaveCount(0);
});

test("ABU-004 ABU-010 delete a lead", async ({ page, api }) => {
  const bot = await leadId(api, "Bot");
  await page.goto(leadsUrl());
  await page.getByTestId(`lead-delete-${bot}`).click();
  await expect(page.getByRole("dialog")).toContainText("Ce contact sera supprimé définitivement.");
  await page.getByTestId("lead-delete-cancel").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId(`lead-row-${bot}`)).toBeVisible();
  expect(await api.leads("seed-alice", mariageId)).toHaveLength(3);

  await page.getByTestId(`lead-delete-${bot}`).click();
  await page.getByTestId("lead-delete-confirm").click();
  await expect(page.getByTestId(`lead-row-${bot}`)).toHaveCount(0);
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(2);
  expect((await api.leads("seed-alice", mariageId)).map((lead) => lead.id)).not.toContain(bot);

  await page.getByTestId("leads-back").click();
  await expect(page.getByTestId(`event-lead-count-${mariageId}`)).toHaveText("2 contacts");
});

test("LEA-002 LEA-015 search by an accent-free name", async ({ page }) => {
  await page.goto(leadsUrl());
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(3);

  await page.getByLabel("Rechercher un contact").fill("eloise");
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(1);
  await expect(page.getByTestId(/^lead-name-/)).toHaveText("Éloïse D’Aubigné-Müller");
  await expect(page.getByTestId("leads-count")).toHaveText("1 contact");

  await page.getByLabel("Rechercher un contact").fill("zzz");
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(0);
  await expect(page.getByTestId("leads-no-match")).toHaveText("Aucun contact ne correspond à ta recherche.");

  await page.getByLabel("Rechercher un contact").fill("");
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(3);
  await expect(page.getByTestId("leads-no-match")).toHaveCount(0);
});

test("LEA-016 search by phone digits", async ({ page, api }) => {
  const eloise = await leadId(api, "Éloïse");
  await page.goto(leadsUrl());
  await page.getByLabel("Rechercher un contact").fill("0612");
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(1);
  await expect(page.getByTestId(`lead-row-${eloise}`)).toBeVisible();
});

test("LEA-003 LEA-018 LEA-019 lead detail", async ({ page, api }) => {
  const eloise = await leadId(api, "Éloïse");
  const zoe = await leadId(api, "Zoé");
  const consent = (await api.leads("seed-alice", mariageId)).find((lead) => lead.id === eloise)?.consent_text;
  if (!consent) throw new Error("the seeded contact has no consent text");
  await page.goto(leadsUrl());

  await page.getByTestId(`lead-open-${eloise}`).click();
  const detail = page.getByTestId("lead-detail");
  await expect(detail).toContainText("Éloïse D’Aubigné-Müller");
  await expect(page.getByTestId("lead-detail-event")).toContainText(MARIAGE);
  await expect(page.getByTestId("lead-detail-field-email")).toContainText("eloise@example.test");
  await expect(page.getByTestId("lead-detail-field-phone")).toContainText("+33 6 12 34 56 78");
  await expect(page.getByTestId(`lead-detail-answer-${WEDDING_DATE_FIELD}`)).toContainText("Date du mariage18/09/2027");
  await expect(page.getByTestId(`lead-detail-answer-${WEDDING_GUESTS_FIELD}`)).toContainText("Nombre d'invités120");
  await expect(page.getByTestId(`lead-detail-answer-${WEDDING_PLAN_FIELD}`)).toContainText("FormulePrestige");
  await expect(page.getByTestId(`lead-detail-answer-${WEDDING_BROCHURE_FIELD}`)).toContainText("Recevoir la brochureOui");
  await expect(page.getByTestId("lead-detail-consent")).toContainText(consent);
  await expect(page.getByTestId("lead-detail-spam-state")).toHaveText("Non marqué comme spam");
  await detail.getByRole("button", { name: "Fermer" }).click();
  await expect(detail).toHaveCount(0);

  await page.getByTestId(`lead-open-${zoe}`).click();
  await expect(page.getByTestId(`lead-detail-answer-${WEDDING_DATE_FIELD}`)).toContainText("Non renseigné");
  await expect(page.getByTestId(`lead-detail-answer-${WEDDING_BROCHURE_FIELD}`)).toHaveText(/Recevoir la brochure\s*Non$/);
});

test("FRM-023 LEA-018 a deleted field stays in the detail", async ({ page }) => {
  await page.goto(`/dashboard/cards/${aliceCardId}/events/${parisId}/leads`);
  await page.getByTestId(/^lead-open-/).click();
  await expect(page.getByTestId("lead-detail")).toContainText("Jean-Michel Hébert");
  await expect(page.getByTestId(`lead-detail-answer-${DELETED_COMPANY_FIELD}`)).toContainText("EntrepriseHébert & Fils");
});

test("LEA-004 LEA-020 spam and delete from the detail view", async ({ page, api }) => {
  const zoe = await leadId(api, "Zoé");
  const bot = await leadId(api, "Bot");
  await page.goto(leadsUrl());

  await page.getByTestId(`lead-open-${zoe}`).click();
  await page.getByTestId("lead-detail-spam").click();
  await expect(page.getByTestId("lead-detail-spam-state")).toHaveText("Marqué comme spam");
  await page.getByTestId("lead-detail").getByRole("button", { name: "Fermer" }).click();
  await expect(page.getByTestId(`lead-spam-badge-${zoe}`)).toHaveText("Spam");

  await page.getByTestId(`lead-open-${bot}`).click();
  await page.getByTestId("lead-detail-delete").click();
  await page.getByTestId("lead-delete-confirm").click();
  await expect(page.getByTestId("lead-detail")).toHaveCount(0);
  await expect(page.getByTestId(`lead-row-${bot}`)).toHaveCount(0);
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(2);
  expect((await api.leads("seed-alice", mariageId)).map((lead) => lead.id)).not.toContain(bot);
});

test("LEA-005 a deleted lead is gone after reload and from the search", async ({ page, api }) => {
  const bot = await leadId(api, "Bot");
  await page.goto(leadsUrl());
  await page.getByTestId(`lead-delete-${bot}`).click();
  await page.getByTestId("lead-delete-confirm").click();
  await expect(page.getByTestId(`lead-row-${bot}`)).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(2);
  await page.getByLabel("Rechercher un contact").fill("bot");
  await expect(page.getByTestId("leads-no-match")).toBeVisible();
});

test("ACC-017 another user's leads are not reachable", async ({ page, loginAs }) => {
  await loginAs("seed-bob");
  await page.goto(leadsUrl());
  await expect(page.getByTestId("card-not-found")).toHaveText("Carte introuvable");
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(0);
});
