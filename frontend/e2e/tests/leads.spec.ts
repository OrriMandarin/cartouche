import { expect, test, type TestApi } from "../fixtures";

const MARIAGE = "Salon du Mariage Clermont 2027";

let aliceCardId: string;
let mariageId: string;

// The events scenario freezes the API clock at T0 before seeding: sign in only afterwards.
test.beforeEach(async ({ api, loginAs }) => {
  const { cards, events } = await api.seedEvents();
  const card = cards.find((c) => c.slug === "alice-durand");
  const mariage = events.find((event) => event.title === MARIAGE);
  if (!card || !mariage) throw new Error("the events scenario has no alice-durand card or no wedding fair");
  aliceCardId = card.id;
  mariageId = mariage.id;
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

test("ACC-017 another user's leads are not reachable", async ({ page, loginAs }) => {
  await loginAs("seed-bob");
  await page.goto(leadsUrl());
  await expect(page.getByTestId("card-not-found")).toHaveText("Carte introuvable");
  await expect(page.getByTestId(/^lead-row-/)).toHaveCount(0);
});
