import { readFile } from "node:fs/promises";
import { TEMPLATE_IDS } from "../../web/src/templates/ids";
import { WEB_URL } from "../env";
import { expect, test } from "../fixtures";

const NEUTRAL_TEXT = "Cette carte n'est plus active";

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
