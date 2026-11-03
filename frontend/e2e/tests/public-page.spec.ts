import { readFile } from "node:fs/promises";
import { TEMPLATE_IDS } from "../../web/src/templates/ids";
import { WEB_URL } from "../env";
import { expect, test } from "../fixtures";

const NEUTRAL_TEXT = "Cette carte n'est plus active";
const MARIAGE = "Salon du Mariage Clermont 2027";

let aliceCardId: string;

test.beforeEach(async ({ api }) => {
  const { cards } = await api.seed("cards");
  const alice = cards.find((card) => card.slug === "alice-durand");
  if (!alice) throw new Error("the cards scenario has no alice-durand card");
  aliceCardId = alice.id;
});

for (const template of TEMPLATE_IDS) {
  test.describe(`template ${template}`, () => {
    test.beforeEach(async ({ api }) => {
      await api.updateCard("seed-alice", aliceCardId, { template });
    });

    test("TPL-003 PUB-011 PUB-003 PUB-001 shows the card on mobile", async ({ page }) => {
      await page.goto("/c/alice-durand");
      await expect(page.getByTestId("card-name")).toHaveText("Alice Durand");
      await expect(page.getByTestId("card-job-title")).toHaveText("Fondatrice");
      await expect(page.getByTestId("card-company")).toHaveText("Atelier Durand & Fils");
      await expect(page.getByTestId("card-description")).toContainText("Créatrice de cartes ✨");
      await expect(page.getByTestId("card-description")).toContainText("l'artisanat d'aujourd'hui");
      // Nothing makes the page wider than the screen (PUB-001).
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("PUB-012 PUB-021 links, email and phone", async ({ page }) => {
      await page.goto("/c/alice-durand");
      await expect(page.getByTestId("card-link-0")).toHaveAttribute("href", "https://www.linkedin.com/in/alice");
      await expect(page.getByTestId("card-link-1")).toHaveAttribute("href", "https://alice.example.test");
      await expect(page.getByTestId("card-link-1")).toContainText("Portfolio");
      await expect(page.getByTestId("card-email")).toHaveAttribute("href", "mailto:alice@example.test");
      await expect(page.getByTestId("card-phone")).toHaveAttribute("href", "tel:+33612345678");
    });

    test("PUB-014 PUB-027 save contact downloads the vCard", async ({ page }) => {
      await page.goto("/c/alice-durand");
      const downloading = page.waitForEvent("download");
      await page.getByTestId("save-contact").click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe("alice-durand.vcf");
      const content = await readFile(await download.path(), "utf8");
      expect(content.startsWith("BEGIN:VCARD")).toBe(true);
      expect(content).toContain("FN:Alice Durand");
    });

    test("TPL-003 TPL-020 FRM-001 FRM-006 event button, form and consent on every template", async ({ page, api }) => {
      // The events scenario starts from an empty database: the card gets its template again.
      const { cards, events } = await api.seedEvents();
      const alice = cards.find((card) => card.slug === "alice-durand");
      const mariage = events.find((event) => event.title === MARIAGE);
      if (!alice || !mariage) throw new Error("the events scenario has no alice-durand wedding fair");
      await api.updateCard("seed-alice", alice.id, { template });

      await page.goto("/c/alice-durand");
      await page.getByTestId(`event-button-${mariage.id}`).click();
      await expect(page).toHaveURL(new RegExp(`/c/alice-durand/e/${mariage.id}$`));
      await expect(page.getByTestId("event-form-page")).toHaveAttribute("style", /--c-accent:/);
      await expect(page.getByTestId("consent-text")).toContainText("Alice Durand (Atelier Durand & Fils)");
      await page.getByTestId("field-answers.first_name").fill("Maëlle");
      await page.getByTestId("field-answers.last_name").fill("N’Guessan-Lefèvre ✨");
      await page.getByTestId("field-answers.email").fill("maelle@example.test");
      await page.getByTestId("consent-checkbox").check();
      await page.getByTestId("event-form-submit").click();
      await expect(page.getByTestId("event-form-confirmation")).toBeVisible();
    });

    test("PUB-017 link preview tags", async ({ page }) => {
      await page.goto("/c/alice-durand");
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Alice Durand");
      await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
        "content",
        "Fondatrice · Atelier Durand & Fils",
      );
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
        "content",
        `${WEB_URL}/c/alice-durand`,
      );
    });
  });
}

test("PUB-008 PUB-009 PUB-029 running events are buttons sorted by start", async ({ page, api }) => {
  const { events } = await api.seedEvents();
  const idOf = (title: string) => {
    const event = events.find((candidate) => candidate.title === title);
    if (!event) throw new Error(`no seeded event "${title}"`);
    return event.id;
  };
  await page.goto("/c/alice-durand");
  const buttons = page.getByTestId(/^event-button-/);
  await expect(page.getByTestId("card-event-name")).toHaveText([
    MARIAGE,
    "Portes ouvertes de l'Atelier",
    "Démonstration en boutique",
  ]);
  const testIds = await buttons.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-testid")));
  expect(testIds).toEqual([
    `event-button-${idOf(MARIAGE)}`,
    `event-button-${idOf("Portes ouvertes de l'Atelier")}`,
    `event-button-${idOf("Démonstration en boutique")}`,
  ]);
  // Ended ten minutes ago, or not started yet: no button.
  await expect(page.getByTestId(`event-button-${idOf("Atelier découverte")}`)).toHaveCount(0);
  await expect(page.getByTestId(`event-button-${idOf("Foire de Lyon")}`)).toHaveCount(0);
});

test("PUB-010 no running event, no button", async ({ page }) => {
  await page.goto("/c/alice-durand");
  await expect(page.getByTestId("card-name")).toHaveText("Alice Durand");
  await expect(page.getByTestId(/^event-button-/)).toHaveCount(0);
});

test("PUB-030 PUB-033 the save button sits right under the identity", async ({ page }) => {
  await page.goto("/c/alice-durand");
  const box = async (testId: string) => {
    const found = await page.getByTestId(testId).boundingBox();
    if (!found) throw new Error(`${testId} is not visible`);
    return found;
  };
  const description = await box("card-description");
  const save = await box("save-contact");
  const email = await box("card-email");
  expect(save.y).toBeGreaterThan(description.y + description.height);
  expect(email.y).toBeGreaterThan(save.y + save.height);
  // Inverted colors: the button's background is the card's text color, its text the card's background.
  const colors = await page.getByTestId("save-contact").evaluate((element) => {
    const card = element.closest("article")!;
    const probe = document.createElement("span");
    probe.style.color = "var(--c-bg)";
    card.append(probe);
    const result = {
      background: getComputedStyle(element).backgroundColor,
      color: getComputedStyle(element).color,
      text: getComputedStyle(card).color,
      cardBackground: getComputedStyle(probe).color,
    };
    probe.remove();
    return result;
  });
  expect(colors.background).toBe(colors.text);
  expect(colors.color).toBe(colors.cardBackground);
});

test("PUB-035 PUB-036 links show as icons with labelled free links", async ({ page }) => {
  await page.goto("/c/alice-durand");
  const icons = page.getByRole("list", { name: "Réseaux" });
  const linkedin = icons.getByTestId("card-link-0");
  await expect(linkedin).toHaveAttribute("aria-label", "LinkedIn — linkedin.com/in/alice");
  await expect(linkedin).toHaveText("");
  await expect(linkedin.locator("svg")).toHaveCount(1);
  const size = await linkedin.boundingBox();
  expect(size?.width).toBeGreaterThanOrEqual(44);
  expect(size?.height).toBeGreaterThanOrEqual(44);

  const portfolio = page.getByRole("list", { name: "Liens" }).getByTestId("card-link-1");
  await expect(portfolio).toContainText("Portfolio");
  await expect(portfolio).toContainText("alice.example.test");
});

test("PUB-023 a card without photo shows its initials", async ({ page }) => {
  await page.goto("/c/alice-durand");
  await expect(page.getByTestId("card-initials")).toHaveText("AD");
  await expect(page.getByTestId("card-avatar")).toHaveCount(0);
});

test("PUB-038 reduced motion stops the event sheen and the pulse", async ({ page, api }) => {
  const { events } = await api.seedEvents();
  const mariage = events.find((event) => event.title === MARIAGE);
  if (!mariage) throw new Error("the events scenario has no wedding fair");
  const animations = async () =>
    page.getByTestId(`event-button-${mariage.id}`).evaluate((button) => ({
      sheen: getComputedStyle(button, "::after").animationName,
      dot: getComputedStyle(button.querySelector(".cc-dot")!, "::after").animationName,
    }));

  await page.goto("/c/alice-durand");
  expect(await animations()).toEqual({ sheen: "cc-sheen", dot: "cc-ping" });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  expect(await animations()).toEqual({ sheen: "none", dot: "none" });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("PUB-002 page is rendered by the server", async ({ page }) => {
    await page.goto("/c/alice-durand");
    await expect(page.getByTestId("card-name")).toHaveText("Alice Durand");
    await expect(page.getByTestId("card-phone")).toHaveAttribute("href", "tel:+33612345678");
  });
});

test("PUB-002 PUB-017 the link preview tags are in the HTML the server sends", async ({ api }) => {
  const response = await api.get(`${WEB_URL}/c/alice-durand`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("charset=utf-8");
  const html = await response.text();
  expect(html).toMatch(/<meta property="og:title" content="Alice Durand"/);
  expect(html).toContain("Créatrice de cartes ✨");
});

test("TPL-012 no request to Google Fonts", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await page.goto("/c/alice-durand");
  await expect(page.getByTestId("card-name")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(requested.filter((url) => /fonts\.(googleapis|gstatic)\.com/.test(url))).toEqual([]);
});

test("LNK-003 LNK-024 old slug redirects permanently", async ({ page, api }) => {
  await page.goto("/c/alice");
  expect(page.url()).toMatch(/\/c\/alice-durand$/);
  await expect(page.getByTestId("card-name")).toHaveText("Alice Durand");

  const response = await api.get(`${WEB_URL}/c/alice`, { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(response.headers()["location"]).toMatch(/\/c\/alice-durand$/);
});

test("LNK-021 uppercase slug redirects to lowercase", async ({ page, api }) => {
  await page.goto("/c/Alice-Durand");
  expect(page.url()).toMatch(/\/c\/alice-durand$/);
  await expect(page.getByTestId("card-name")).toHaveText("Alice Durand");

  const response = await api.get(`${WEB_URL}/c/Alice-Durand`, { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(response.headers()["location"]).toMatch(/\/c\/alice-durand$/);
});

test("LNK-024 LNK-030 permanent redirects are not cached", async ({ api }) => {
  for (const path of ["/c/alice", "/c/Alice-Durand", "/api/public/cards/alice/vcard"]) {
    const response = await api.get(`${WEB_URL}${path}`, { maxRedirects: 0 });
    expect(response.status(), path).toBe(308);
    expect(response.headers()["cache-control"], path).toContain("no-store");
  }
});

test("LNK-006 LNK-027 disabled card shows the neutral page", async ({ page }) => {
  const response = await page.goto("/c/alice-archive");
  expect(response?.status()).toBe(200);
  await expect(page.getByText(NEUTRAL_TEXT)).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('meta[property="og:title"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:image"]')).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toContain("Ancien poste");
  expect(html).not.toContain("Alice");
  await expect(page.getByTestId("card-name")).toHaveCount(0);
});

test("LNK-010 support-disabled card shows the same neutral page", async ({ page }) => {
  const response = await page.goto("/c/bob-martin");
  expect(response?.status()).toBe(200);
  await expect(page.getByText(NEUTRAL_TEXT)).toBeVisible();
  await expect(page.locator("main")).toHaveText(NEUTRAL_TEXT);
  expect(await page.locator("body").innerText()).not.toMatch(/support|bob|martin/i);
});

test("ADM-011 suspended owner shows the neutral page", async ({ page }) => {
  const response = await page.goto("/c/dan-moreau");
  expect(response?.status()).toBe(200);
  await expect(page.locator("main")).toHaveText(NEUTRAL_TEXT);
  expect(await page.locator("body").innerText()).not.toMatch(/dan|moreau/i);
});

test("LNK-012 deleted card shows the neutral page", async ({ page }) => {
  const response = await page.goto("/c/alice-ancienne");
  expect(response?.status()).toBe(200);
  await expect(page.locator("main")).toHaveText(NEUTRAL_TEXT);
});

test("LNK-023 unknown slug is a 404", async ({ page }) => {
  const response = await page.goto("/c/personne");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Carte introuvable")).toBeVisible();
});

test("LNK-007 vCard of a disabled card is refused", async ({ api }) => {
  const response = await api.get("/api/public/cards/alice-archive/vcard");
  expect(response.status()).toBe(410);
});
