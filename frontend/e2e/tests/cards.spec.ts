import { readFile } from "node:fs/promises";
import { WEB_URL } from "../env";
import { expect, test } from "../fixtures";

const UNAVAILABLE_TITLE = "Cette carte n’est pas disponible";

test.beforeEach(async ({ api, loginAs }) => {
  await api.seed("cards");
  await loginAs("seed-alice");
});

test("EDI-013 LNK-001 LNK-019 create a card from a suggested slug", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByTestId("new-card").click();
  await expect(page).toHaveURL(/\/dashboard\/cards\/new$/);

  await page.getByTestId("new-card-first-name").fill("Alice");
  await page.getByTestId("new-card-last-name").fill("Durand");
  // alice-durand is taken: the proposal is the first free suffix.
  await expect(page.getByTestId("slug-input")).toHaveValue("alice-durand-2");
  await expect(page.getByTestId("slug-status")).toHaveText("Disponible");
  await page.getByTestId("new-card-submit").click();

  await expect(page).toHaveURL(/\/dashboard\/cards\/[0-9a-f-]{36}$/);
  await page.goto("/c/alice-durand-2");
  await expect(page.getByTestId("card-name")).toHaveText("Alice Durand");
});

test("LNK-020 taken slug is flagged before saving", async ({ page }) => {
  await page.goto("/dashboard/cards/new");
  await page.getByTestId("slug-input").fill("bob-martin");
  await expect(page.getByTestId("slug-status")).toHaveText("Déjà pris");
  await expect(page.getByTestId("new-card-submit")).toBeDisabled();

  await page.getByTestId("slug-input").fill("a");
  await expect(page.getByTestId("slug-status")).toHaveText("Invalide");
  await expect(page.getByTestId("new-card-submit")).toBeDisabled();
});

test("EDI-001 LNK-005 LNK-009 disable then enable", async ({ page }) => {
  await page.goto("/dashboard");
  const row = page.getByTestId("card-row-alice-durand");
  await expect(page.getByTestId("card-status-alice-durand")).toHaveText("Active");

  await row.getByTestId("card-disable-alice-durand").click();
  await expect(page.getByTestId("card-status-alice-durand")).toHaveText("Désactivée");
  await page.goto("/c/alice-durand");
  await expect(page.getByTestId("card-unavailable")).toContainText(UNAVAILABLE_TITLE);
  await expect(page.getByTestId("card-name")).toHaveCount(0);

  await page.goto("/dashboard");
  await page.getByTestId("card-enable-alice-durand").click();
  await expect(page.getByTestId("card-status-alice-durand")).toHaveText("Active");
  await page.goto("/c/alice-durand");
  await expect(page.getByTestId("card-name")).toHaveText("Alice Durand");
});

test("LNK-011 support-disabled card for its owner", async ({ page, loginAs }) => {
  await loginAs("seed-bob");
  await page.goto("/dashboard");
  await expect(page.getByTestId("card-status-bob-martin")).toHaveText("Désactivée par le support");
  await expect(page.getByTestId("card-blocked-bob-martin")).toHaveText("Désactivée par le support");
  await expect(page.getByTestId("card-enable-bob-martin")).toHaveCount(0);
  await expect(page.getByTestId("card-disable-bob-martin")).toHaveCount(0);
});

test("EDI-014 duplicate a card", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByTestId("card-duplicate-alice-durand").click();
  await page.getByTestId("slug-input").fill("alice-bis");
  await expect(page.getByTestId("slug-status")).toHaveText("Disponible");
  await page.getByTestId("card-duplicate-confirm").click();

  await expect(page.getByTestId("card-row-alice-bis")).toBeVisible();
  await expect(page.getByTestId("card-url-alice-bis")).toHaveText(`${WEB_URL}/c/alice-bis`);
  await page.goto("/c/alice-bis");
  await expect(page.getByTestId("card-name")).toHaveText("Alice Durand");
  await expect(page.getByTestId("card-job-title")).toHaveText("Fondatrice");
});

test("EDI-002 LNK-012 delete with confirmation", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByTestId("card-delete-alice-durand").click();
  await page.getByTestId("card-delete-cancel").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("card-row-alice-durand")).toBeVisible();

  await page.getByTestId("card-delete-alice-durand").click();
  await page.getByTestId("card-delete-confirm").click();
  await expect(page.getByTestId("card-row-alice-durand")).toHaveCount(0);
  // Her other card is still there.
  await expect(page.getByTestId("card-row-alice-archive")).toBeVisible();
  await page.goto("/c/alice-durand");
  await expect(page.getByTestId("card-unavailable")).toContainText(UNAVAILABLE_TITLE);
});

test("LNK-017 LNK-029 share: link and QR codes", async ({ page, context, browserName }) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("card-url-alice-durand")).toHaveText(`${WEB_URL}/c/alice-durand`);
  await expect(page.getByTestId("card-copy-alice-durand")).toBeVisible();

  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByTestId("card-copy-alice-durand").click();
    await expect(page.getByTestId("card-share-feedback-alice-durand")).toHaveText("Lien copié");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${WEB_URL}/c/alice-durand`);
  }

  const svgDownload = page.waitForEvent("download");
  await page.getByTestId("card-qr-svg-alice-durand").click();
  const svg = await svgDownload;
  expect(svg.suggestedFilename()).toBe("alice-durand.svg");
  expect(await readFile(await svg.path(), "utf8")).toContain("<svg");

  const pngDownload = page.waitForEvent("download");
  await page.getByTestId("card-qr-png-alice-durand").click();
  const png = await pngDownload;
  expect(png.suggestedFilename()).toBe("alice-durand.png");
  const header = (await readFile(await png.path())).subarray(0, 4);
  expect([...header]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});
