import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { EVENTS_NOW, WEB_URL } from "../env";
import { expect, test } from "../fixtures";

const MARIAGE = "Salon du Mariage Clermont 2027";
const PORTES = "Portes ouvertes de l'Atelier";
const DEMO = "Démonstration en boutique";
const DECOUVERTE = "Atelier découverte";
const LYON = "Foire de Lyon";
const ARCHIVE = "Événement archivé";
const BLOQUE = "Salon bloqué";

const UNAVAILABLE_TITLE = "Cette carte n’est pas disponible";
const UNAVAILABLE_TEXT = "Le lien est peut-être incorrect, ou la carte n’est plus active.";

let eventIds: Record<string, string>;
let aliceCardId: string;

// The events scenario freezes the API clock at T0 before seeding: no token is signed before it.
test.beforeEach(async ({ api }) => {
  const { cards, events } = await api.seedEvents();
  eventIds = Object.fromEntries(events.map((event) => [event.title, event.id]));
  const alice = cards.find((card) => card.slug === "alice-durand");
  if (!alice) throw new Error("the events scenario has no alice-durand card");
  aliceCardId = alice.id;
});

const idOf = (title: string) => {
  const id = eventIds[title];
  if (!id) throw new Error(`no seeded event "${title}"`);
  return id;
};
const formUrl = (title: string, slug = "alice-durand") => `/c/${slug}/e/${idOf(title)}`;
const minutesAfterNow = (minutes: number) => new Date(Date.parse(EVENTS_NOW) + minutes * 60_000).toISOString();

const field = (page: Page, path: string) => page.getByTestId(`field-${path}`);

/** Fills the required fields of the wedding fair form and ticks the consent box. */
async function fillMariage(page: Page, firstName = "Maëlle") {
  await field(page, "answers.first_name").fill(firstName);
  await field(page, "answers.last_name").fill("N’Guessan-Lefèvre ✨");
  await field(page, "answers.email").fill("maelle@example.test");
  await page.getByTestId("consent-checkbox").check();
}

/** Fills the one field of a form that asks only for an email, and ticks the consent box. */
async function fillEmailOnly(page: Page, email: string) {
  await field(page, "answers.email").fill(email);
  await page.getByTestId("consent-checkbox").check();
}

async function unlock(page: Page, code: string) {
  await page.getByTestId("access-code-input").fill(code);
  await page.getByTestId("access-code-submit").click();
  await expect(page.getByTestId("event-form")).toBeVisible();
}

test("FRM-001 PUB-008 the event button opens the full-screen form with a way back", async ({ page }) => {
  const mariage = idOf(MARIAGE);
  await page.goto("/c/alice-durand");
  await page.getByTestId(`event-button-${mariage}`).click();
  await expect(page).toHaveURL(new RegExp(`/c/alice-durand/e/${mariage}$`));
  await expect(page.getByTestId("event-form-title")).toHaveText(MARIAGE);
  // The form takes the whole screen: nothing of the card page is left.
  await expect(page.getByTestId("card-name")).toHaveCount(0);

  await page.getByTestId("event-form-back").click();
  await expect(page).toHaveURL(/\/c\/alice-durand$/);
  await expect(page.getByTestId("card-name")).toHaveText("Alice Durand");
});

test("FRM-044 the Mariage form has both sections and the privacy link", async ({ page }) => {
  await page.goto(formUrl(MARIAGE));
  // Alice has no photo: her initials, which a screen reader skips (PUB-023).
  await expect(page.getByTestId("event-form-back")).toHaveAccessibleName("Alice Durand");
  await expect(page.getByTestId("event-form-back").locator(".fm-back-av")).toHaveText("AD");
  await expect(page.getByText("Événement en cours")).toBeVisible();
  await expect(page.getByTestId("event-form-title")).toHaveText(MARIAGE);
  await expect(page.getByText("Tous les champs sont obligatoires, sauf mention « facultatif ».")).toBeVisible();
  const contact = page.getByRole("group", { name: "Vos coordonnées" });
  const project = page.getByRole("group", { name: "Votre projet" });
  await expect(contact.getByTestId("field-answers.email")).toBeVisible();
  await expect(project.getByLabel(/^Date du mariage/)).toHaveAttribute("type", "date");
  await expect(page.getByTestId("event-form-submit")).toHaveText("Envoyer mes coordonnées");
  await expect(page.getByText("Vos informations sont transmises uniquement à Alice Durand.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Vos données personnelles" })).toHaveAttribute("href", "/confidentialite");
});

test("FRM-048 the Portes ouvertes code screen", async ({ page, api }) => {
  await api.updateEvent("seed-alice", idOf(PORTES), { description: "Visite guidée de l’atelier ✨" });
  await page.goto(formUrl(PORTES));
  await expect(page.getByTestId("event-form-back")).toHaveAccessibleName("Alice Durand");
  await expect(page.getByTestId("event-form-title")).toHaveText(PORTES);
  await expect(page.getByLabel("Code d’accès")).toBeEnabled();
  await expect(page.getByLabel("Code d’accès")).toHaveAttribute("data-testid", "access-code-input");
  await expect(page.getByRole("button", { name: "Continuer" })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(1);
  // The title only: no label, no description before the code (EVT-027).
  await expect(page.getByText("Événement en cours")).toHaveCount(0);
  await expect(page.getByTestId("event-form-description")).toHaveCount(0);
  await expect(page.getByText("Visite guidée")).toHaveCount(0);
});

test("FRM-049 a dark theme gives dark native controls", async ({ page, api }, testInfo) => {
  await api.updateCard("seed-alice", aliceCardId, { theme: { preset: "encre" } });
  await page.goto(formUrl(MARIAGE));
  await expect(page.getByTestId("event-form-title")).toHaveText(MARIAGE);
  const frame = await page.evaluate(() => {
    const wrapper = document.querySelector<HTMLElement>(".cc-page");
    const card = document.querySelector<HTMLElement>(".cc");
    const consent = document.querySelector<HTMLElement>("[data-testid=consent-checkbox]");
    return {
      scheme: wrapper ? getComputedStyle(wrapper).colorScheme : "",
      controls: consent ? getComputedStyle(consent).colorScheme : "",
      danger: wrapper?.style.getPropertyValue("--c-danger") ?? "",
      width: card?.getBoundingClientRect().width ?? 0,
      radius: card ? getComputedStyle(card).borderTopLeftRadius : "",
      viewport: document.documentElement.clientWidth,
    };
  });
  expect(frame.scheme).toBe("dark");
  expect(frame.controls).toBe("dark");
  expect(frame.danger).toBe("#FF8A80");
  // Laid out like the card (PUB-037): full screen on a phone, a 28rem card from 40rem.
  if (testInfo.project.name === "desktop") {
    expect(frame.width).toBe(448);
    expect(frame.radius).toBe("28px");
  } else {
    expect(frame.width).toBe(frame.viewport);
  }
});

test("FRM-003 FRM-012 FRM-013 FRM-015 FRM-004 FRM-016 fill, fix, send, confirm", async ({ page, api }) => {
  const mariage = idOf(MARIAGE);
  expect(await api.leads("seed-alice", mariage)).toHaveLength(3);
  await page.goto(formUrl(MARIAGE));
  await expect(page.getByTestId("event-form-title")).toHaveText(MARIAGE);

  await fillMariage(page);
  await field(page, "answers.email").fill("maelle@");
  await page.getByTestId("event-form-submit").click();
  await expect(page.getByTestId("field-error-answers.email")).toHaveText(
    "Vérifiez l’adresse e-mail (exemple\u00a0: nom@domaine.fr).",
  );
  await expect(field(page, "answers.first_name")).toHaveValue("Maëlle");

  await field(page, "answers.email").fill("maelle@example.test");
  await field(page, "answers.phone").fill("06 12 34 56 78");
  const consentText = await page.getByTestId("consent-text").textContent();
  expect(consentText).toContain("Alice Durand (Atelier Durand & Fils)");
  await page.getByTestId("event-form-submit").click();
  await expect(page.getByTestId("event-form-confirmation")).toBeVisible();

  const downloading = page.waitForEvent("download");
  await page.getByTestId("confirmation-save-contact").click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("alice-durand.vcf");
  expect(await readFile(await download.path(), "utf8")).toContain("FN:Alice Durand");

  const leads = await api.leads("seed-alice", mariage);
  expect(leads).toHaveLength(4);
  const lead = leads.find((candidate) => candidate.answers.first_name === "Maëlle");
  expect(lead?.answers).toMatchObject({
    last_name: "N’Guessan-Lefèvre ✨",
    email: "maelle@example.test",
    phone: "+33612345678",
  });
  expect(Date.parse(lead?.submitted_at ?? "")).toBe(Date.parse(EVENTS_NOW));
  expect(lead?.consent_text).toBe(consentText);

  await page.getByTestId("confirmation-back").click();
  await expect(page).toHaveURL(/\/c\/alice-durand$/);
});

test("FRM-046 four errors: summary, focus and messages", async ({ page }) => {
  await page.goto(formUrl(MARIAGE));
  await field(page, "answers.first_name").fill("Inès");
  await field(page, "answers.email").fill("ines.martin@");
  const guests = page.getByLabel(/Nombre d'invités/);
  await guests.fill("abc");
  await page.getByTestId("event-form-submit").click();

  await expect(page.getByTestId("event-form-summary")).toHaveText(
    "Vos coordonnées n’ont pas été envoyées\u00a0: 4 champs sont à corriger.",
  );
  await expect(field(page, "answers.last_name")).toBeFocused();
  await expect(page.getByTestId("field-error-answers.last_name")).toHaveText("Indiquez votre nom.");
  await expect(page.getByTestId("field-error-answers.email")).toHaveText(
    "Vérifiez l’adresse e-mail (exemple\u00a0: nom@domaine.fr).",
  );
  await expect(guests.locator("xpath=..").locator(".fm-error")).toHaveText(
    "Indiquez un nombre, par exemple 80 ou 12,5.",
  );
  await expect(page.getByTestId("field-error-consent")).toHaveText(
    "Cochez cette case pour envoyer vos coordonnées.",
  );
  await expect(field(page, "answers.first_name")).toHaveValue("Inès");
  await expect(field(page, "answers.email")).toHaveValue("ines.martin@");
  await expect(guests).toHaveValue("abc");
});

test("FRM-047 confirmation and vCard of Alice", async ({ page }) => {
  await page.goto(formUrl(MARIAGE));
  await fillMariage(page, "Inès");
  await page.getByTestId("event-form-submit").click();

  const confirmation = page.getByTestId("event-form-confirmation");
  await expect(confirmation.getByRole("heading")).toHaveText("Merci Inès, c’est envoyé\u00a0!");
  await expect(confirmation).toContainText("Alice Durand a bien reçu vos coordonnées.");
  await expect(page.getByTestId("confirmation-save-contact")).toHaveText("Enregistrer le contact d’Alice");
  await expect(page.getByTestId("confirmation-back")).toHaveText("Retour à la carte");
});

test("FRM-043 a date and time answer reaches the owner", async ({ page, api }) => {
  const demo = idOf(DEMO);
  await page.goto(formUrl(DEMO));
  await page.getByLabel(/Rendez-vous souhaité/).fill("2027-03-20T14:30");
  await fillEmailOnly(page, "rdv@example.test");
  await page.getByTestId("event-form-submit").click();
  await expect(page.getByTestId("event-form-confirmation")).toBeVisible();

  const [lead] = await api.leads("seed-alice", demo);
  expect(lead?.custom.find((answer) => answer.label === "Rendez-vous souhaité")?.value).toBe("2027-03-20T14:30");
});

test("FRM-002 EVT-011 the access code ignores case, spaces and accents", async ({ page }) => {
  await page.goto(formUrl(PORTES));
  await expect(page.getByTestId("event-form-title")).toHaveText(PORTES);
  await page.getByTestId("access-code-input").fill("moulin");
  await page.getByTestId("access-code-submit").click();
  await expect(page.getByTestId("access-code-message")).toHaveText(
    "Ce code n’est pas le bon. Vérifiez-le et réessayez.",
  );
  await expect(page.getByTestId("event-form")).toHaveCount(0);

  await unlock(page, "  chateau ");
  await expect(field(page, "answers.first_name")).toBeVisible();
  await expect(page.getByTestId("consent-text")).toHaveText(
    "Vos coordonnées restent chez l'Atelier Durand & Fils, qui ne les partage avec personne.",
  );
});

test("EVT-012 EVT-027 the access code is never sent to the browser", async ({ page, api }) => {
  const portes = idOf(PORTES);
  await api.updateEvent("seed-alice", portes, { description: "Visite guidée de l’atelier ✨" });
  const bodies: Promise<string>[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/public/")) bodies.push(response.text().catch(() => ""));
  });

  await page.goto(formUrl(PORTES));
  await expect(page.getByTestId("access-code-input")).toBeEnabled();
  const locked = await page.content();
  expect(locked).not.toContain("Château");
  // Before the code: the title only, neither the description nor any field nor the consent text.
  expect(locked).not.toContain("Visite guidée");
  expect(locked).not.toContain("Vos coordonnées restent");
  await expect(page.getByTestId(/^field-answers\./)).toHaveCount(0);

  await unlock(page, "chateau");
  await expect(page.getByTestId("event-form-description")).toHaveText("Visite guidée de l’atelier ✨");
  expect(await page.content()).not.toContain("Château");
  const received = await Promise.all(bodies);
  expect(received.length).toBeGreaterThan(0);
  for (const body of received) expect(body).not.toContain("Château");

  const served = await api.get(`${WEB_URL}${formUrl(PORTES)}`);
  expect(served.status()).toBe(200);
  expect(await served.text()).not.toContain("Château");
});

test("FRM-041 EVT-013 a changed code sends the prospect back to the code screen", async ({ page, api }) => {
  const portes = idOf(PORTES);
  await page.goto(formUrl(PORTES));
  await unlock(page, "chateau");
  await field(page, "answers.first_name").fill("Zoé");
  await fillEmailOnly(page, "zoe.nouvelle@example.test");

  await api.updateEvent("seed-alice", portes, { access_code: "Moulin" });
  await page.getByTestId("event-form-submit").click();
  await expect(page.getByTestId("access-code-message")).toContainText("Le code d’accès a changé.");
  await expect(page.getByTestId("event-form")).toHaveCount(0);

  await unlock(page, "moulin");
  // Nothing to type again.
  await expect(field(page, "answers.first_name")).toHaveValue("Zoé");
  await expect(field(page, "answers.email")).toHaveValue("zoe.nouvelle@example.test");
  await page.getByTestId("event-form-submit").click();
  await expect(page.getByTestId("event-form-confirmation")).toBeVisible();
  expect((await api.leads("seed-alice", portes)).map((lead) => lead.answers.first_name)).toEqual(["Zoé"]);
});

test("EVT-014 FRM-042 a second submission from the same device is refused", async ({ page, api }) => {
  const demo = idOf(DEMO);
  await page.goto(formUrl(DEMO));
  await fillEmailOnly(page, "premier@example.test");
  await page.getByTestId("event-form-submit").click();
  await expect(page.getByTestId("event-form-confirmation")).toBeVisible();

  await page.goto(formUrl(DEMO));
  await fillEmailOnly(page, "second@example.test");
  await page.getByTestId("event-form-submit").click();
  await expect(page.getByTestId("event-form-message")).toHaveText(
    "Vous avez déjà envoyé ce formulaire depuis cet appareil.",
  );
  await expect(field(page, "answers.email")).toHaveValue("second@example.test");
  expect((await api.leads("seed-alice", demo)).map((lead) => lead.answers.email)).toEqual(["premier@example.test"]);
});

test("EVT-015 a new private context can submit again", async ({ page, api, browser }) => {
  const demo = idOf(DEMO);
  await page.goto(formUrl(DEMO));
  await fillEmailOnly(page, "premier@example.test");
  await page.getByTestId("event-form-submit").click();
  await expect(page.getByTestId("event-form-confirmation")).toBeVisible();

  const privateContext = await browser.newContext({ baseURL: WEB_URL });
  try {
    const other = await privateContext.newPage();
    await other.goto(formUrl(DEMO));
    await fillEmailOnly(other, "prive@example.test");
    await other.getByTestId("event-form-submit").click();
    await expect(other.getByTestId("event-form-confirmation")).toBeVisible();
  } finally {
    await privateContext.close();
  }
  expect(await api.leads("seed-alice", demo)).toHaveLength(2);
});

test("EVT-008 EVT-026 a form opened during the grace period can still be sent", async ({ page, api, browser }) => {
  const decouverte = idOf(DECOUVERTE);
  // Ended ten minutes ago: the form still opens.
  await page.goto(formUrl(DECOUVERTE));
  await field(page, "answers.first_name").fill("Léon");
  await fillEmailOnly(page, "leon@example.test");
  await api.setClock(minutesAfterNow(4));
  await page.getByTestId("event-form-submit").click();
  await expect(page.getByTestId("event-form-confirmation")).toBeVisible();

  const otherContext = await browser.newContext({ baseURL: WEB_URL });
  try {
    const late = await otherContext.newPage();
    await late.goto(formUrl(DECOUVERTE));
    await field(late, "answers.first_name").fill("Inès");
    await fillEmailOnly(late, "ines@example.test");
    // The end of the event plus 15 minutes is past.
    await api.setClock(minutesAfterNow(6));
    await late.getByTestId("event-form-submit").click();
    await expect(late.getByTestId("event-form-message")).toContainText("fermé");
  } finally {
    await otherContext.close();
  }
  expect((await api.leads("seed-alice", decouverte)).map((lead) => lead.answers.first_name)).toEqual(["Léon"]);
});

test("FRM-024 an upcoming event shows the closed screen", async ({ page }) => {
  const response = await page.goto(formUrl(LYON));
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("event-form-title")).toHaveText(LYON);
  await expect(page.getByTestId("event-closed")).toHaveText("Ce formulaire n’est pas ouvert en ce moment.");
  await expect(page.getByTestId("event-form")).toHaveCount(0);
  await page.getByTestId("event-form-back").click();
  await expect(page).toHaveURL(/\/c\/alice-durand$/);
});

test("FRM-024 an unknown event of a served card still says Formulaire introuvable", async ({ page }) => {
  const unknown = await page.goto("/c/alice-durand/e/0198c8a2-0000-7000-8000-0000000000ff");
  expect(unknown?.status()).toBe(404);
  await expect(page.getByTestId("event-form-not-found")).toHaveText("Formulaire introuvable");
  await expect(page.getByTestId("card-unavailable")).toHaveCount(0);

  const malformed = await page.goto("/c/alice-durand/e/abc");
  expect(malformed?.status()).toBe(404);
  await expect(page.getByText("Formulaire introuvable")).toBeVisible();

  // An event of another card is unknown here.
  const elsewhere = await page.goto(`/c/alice-durand/e/${idOf(BLOQUE)}`);
  expect(elsewhere?.status()).toBe(404);
  await expect(page.getByText("Formulaire introuvable")).toBeVisible();
});

test("LNK-007 FRM-024 the form of an inactive card is the same 404 page", async ({ page }) => {
  for (const url of [formUrl(ARCHIVE, "alice-archive"), formUrl(BLOQUE, "bob-martin"), formUrl(MARIAGE, "inconnu-zz")]) {
    const response = await page.goto(url);
    expect(response?.status(), url).toBe(404);
    const unavailable = page.getByTestId("card-unavailable");
    await expect(unavailable.getByRole("heading", { level: 1 }), url).toHaveText(UNAVAILABLE_TITLE);
    await expect(unavailable, url).toContainText(UNAVAILABLE_TEXT);
    await expect(page.getByTestId("event-form"), url).toHaveCount(0);
    await expect(page.getByTestId("event-form-not-found"), url).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]').first(), url).toHaveAttribute("content", /noindex/);
    await expect(page.locator('meta[property^="og:"]'), url).toHaveCount(0);
  }
});

test("FRM-024 LNK-030 an old slug redirects to the current form address", async ({ page, api }) => {
  const mariage = idOf(MARIAGE);
  for (const slug of ["alice", "Alice-Durand"]) {
    const response = await api.get(`${WEB_URL}/c/${slug}/e/${mariage}`, { maxRedirects: 0 });
    expect(response.status(), slug).toBe(308);
    expect(response.headers()["location"], slug).toMatch(new RegExp(`/c/alice-durand/e/${mariage}$`));
    expect(response.headers()["cache-control"], slug).toContain("no-store");
  }
  await page.goto(`/c/alice/e/${mariage}`);
  await expect(page).toHaveURL(new RegExp(`/c/alice-durand/e/${mariage}$`));
  await expect(page.getByTestId("event-form-title")).toHaveText(MARIAGE);
});

test("FRM-005 FRM-039 the form works with the keyboard alone", async ({ page, browserName }) => {
  // Safari (WebKit) moves to every control with Option+Tab; a plain Tab reaches text fields only.
  const next = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await page.goto(formUrl(DEMO));
  const email = field(page, "answers.email");
  await expect(email).toBeEnabled();
  await email.focus();
  await page.keyboard.type("clavier@example.test");
  await page.keyboard.press(next);
  // The trap field is out of the way: the next stop is the optional "Rendez-vous souhaité" field, then the consent.
  const meeting = page.getByTestId("field-answers.custom.0198c8a1-0000-7000-8000-000000000005");
  await expect(meeting).toBeFocused();
  // A native date and time input may stop on each of its parts (day, month, year, hours, minutes).
  for (let stops = 0; stops < 8 && (await meeting.evaluate((input) => input === document.activeElement)); stops++) {
    await page.keyboard.press(next);
  }
  await expect(page.getByTestId("consent-checkbox")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("consent-checkbox")).toBeChecked();
  await page.keyboard.press(next);
  await expect(page.getByTestId("event-form-submit")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("event-form-confirmation")).toBeVisible();
});

test("FRM-040 a reload keeps the answers", async ({ page }) => {
  await page.goto(formUrl(MARIAGE));
  await fillMariage(page, "Zoé");
  await page.reload();
  await expect(field(page, "answers.first_name")).toHaveValue("Zoé");
  await expect(field(page, "answers.last_name")).toHaveValue("N’Guessan-Lefèvre ✨");
  await expect(field(page, "answers.email")).toHaveValue("maelle@example.test");
  // The consent is given again on what is shown now.
  await expect(page.getByTestId("consent-checkbox")).not.toBeChecked();
  await page.getByTestId("consent-checkbox").check();
  await page.getByTestId("event-form-submit").click();
  await expect(page.getByTestId("event-form-confirmation")).toBeVisible();
});

test("ABU-002 ABU-005 a filled honeypot shows the confirmation but stores nothing", async ({ page, api }) => {
  const demo = idOf(DEMO);
  await page.goto(formUrl(DEMO));
  await fillEmailOnly(page, "robot@example.test");
  await page.locator("[name=fax]").fill("01 02 03 04 05", { force: true });
  await page.getByTestId("event-form-submit").click();
  await expect(page.getByTestId("event-form-confirmation")).toBeVisible();
  expect(await api.leads("seed-alice", demo)).toHaveLength(0);

  // The ignored submission did not use up the device's one submission.
  await page.goto(formUrl(DEMO));
  await fillEmailOnly(page, "humain@example.test");
  await page.getByTestId("event-form-submit").click();
  await expect(page.getByTestId("event-form-confirmation")).toBeVisible();
  expect((await api.leads("seed-alice", demo)).map((lead) => lead.answers.email)).toEqual(["humain@example.test"]);
});

test("FRM-030 a form changed while filling reloads with the answers kept", async ({ page, api }) => {
  const mariage = idOf(MARIAGE);
  await page.goto(formUrl(MARIAGE));
  await fillMariage(page);
  await api.updateEvent("seed-alice", mariage, { title: "Salon du Mariage ✨ 2027" });

  await page.getByTestId("event-form-submit").click();
  await expect(page.getByTestId("event-form-message")).toContainText("Le formulaire a été modifié");
  await expect(page.getByTestId("event-form-title")).toHaveText("Salon du Mariage ✨ 2027");
  await expect(page.getByTestId("consent-checkbox")).not.toBeChecked();
  await expect(field(page, "answers.first_name")).toHaveValue("Maëlle");
  await expect(field(page, "answers.email")).toHaveValue("maelle@example.test");
  const consentText = await page.getByTestId("consent-text").textContent();
  expect(consentText).toContain("« Salon du Mariage ✨ 2027 »");

  await page.getByTestId("consent-checkbox").check();
  await page.getByTestId("event-form-submit").click();
  await expect(page.getByTestId("event-form-confirmation")).toBeVisible();
  const lead = (await api.leads("seed-alice", mariage)).find((candidate) => candidate.answers.first_name === "Maëlle");
  expect(lead?.consent_text).toBe(consentText);
});
