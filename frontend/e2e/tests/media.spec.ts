import { readFile } from "node:fs/promises";
import { editorSaveButton, expect, openEditorSection, saveCard, showEditorView, test, type TestApi } from "../fixtures";
import { WEB_URL } from "../env";

let aliceCardId: string;

test.beforeEach(async ({ api, loginAs }) => {
  const { cards } = await api.seed("cards");
  const alice = cards.find((card) => card.slug === "alice-durand");
  if (!alice) throw new Error("the cards scenario has no alice-durand card");
  aliceCardId = alice.id;
  await loginAs("seed-alice");
});

const editorUrl = () => `/dashboard/cards/${aliceCardId}`;
const fixture = (name: string) => new URL(`../fixtures/${name}`, import.meta.url).pathname;

/** The editor of Alice's card, its media section unfolded on a phone. */
async function openMedia(page: import("@playwright/test").Page) {
  await page.goto(editorUrl());
  await openEditorSection(page, "media");
}

test("MED-005 MED-006 PUB-014 avatar is cropped, published as WebP and in the vCard", async ({ page, api }) => {
  await openMedia(page);
  await page.getByTestId("media-avatar-input").setInputFiles(fixture("avatar.jpg"));
  await page.getByTestId("avatar-crop-apply").click();
  await expect(page.getByTestId("media-avatar-current")).toBeVisible();
  await showEditorView(page, "Aperçu");
  await expect(page.getByTestId("phone-preview").getByTestId("card-avatar")).toBeVisible();
  await saveCard(page);

  await page.goto("/c/alice-durand");
  const avatar = page.getByTestId("card-avatar");
  await expect(avatar).toBeVisible();
  expect(await avatar.getAttribute("srcset")).toContain(".webp");

  const vcard = await api.get("/api/public/cards/alice-durand/vcard");
  expect(vcard.ok()).toBe(true);
  expect(await vcard.text()).toContain("PHOTO;ENCODING=b;TYPE=JPEG:");
});

test("MED-003 PUB-005 PUB-006 header video with captured poster", async ({ page }) => {
  await openMedia(page);
  await page.getByTestId("media-header-input").setInputFiles(fixture("header-2s.mp4"));
  // A 16:9 video is framed first (EDI-034).
  await page.getByTestId("video-crop-apply").click();
  await expect(page.getByTestId("media-header-current")).toContainText("Vidéo");
  await saveCard(page);

  await page.goto("/c/alice-durand");
  const video = page.getByTestId("card-header-video");
  await expect(video).toBeVisible();
  expect(await video.getAttribute("poster")).toMatch(/\.webp$/);
  await expect(video).toHaveJSProperty("muted", true);
  await expect(video).toHaveJSProperty("loop", false);
  await expect(video).toHaveAttribute("playsinline", "");
});

test("EDI-034 MED-028 framing the header video", async ({ page, api }) => {
  await openMedia(page);
  await page.getByTestId("media-header-input").setInputFiles(fixture("header-2s.mp4"));

  const dialog = page.getByTestId("video-crop-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("video-crop-frame")).toHaveCount(8);
  const start = dialog.getByRole("slider", { name: "Début de l’extrait" });
  const end = dialog.getByRole("slider", { name: "Fin de l’extrait" });
  await start.focus();
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowRight");
  await expect(start).toHaveAttribute("aria-valuetext", "0,5\u00a0s");
  await end.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(end).toHaveAttribute("aria-valuetext", "1,8\u00a0s");
  await expect(dialog.getByText("Boucle de 1,3\u00a0s")).toBeVisible();
  await dialog.getByTestId("video-crop-poster").check();
  await dialog.getByRole("button", { name: "Appliquer" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("media-header-current")).toContainText("Vidéo");
  await saveCard(page);

  const response = await api.get(`/api/cards/${aliceCardId}`, { headers: await api.authHeaders("seed-alice") });
  const header = ((await response.json()) as { header: { loop: unknown; poster_time: number } }).header;
  expect(header.loop).toEqual({ start: 0.5, end: 1.8 });
  // The playhead followed the end handle: its frame is the waiting image.
  expect(header.poster_time).toBeCloseTo(1.8);

  await page.goto("/c/alice-durand");
  const video = page.getByTestId("card-header-video");
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime >= 0.5 && !el.paused)).toBe(true);

  // « Recadrer » starts from the stored loop; a new waiting image is captured from the stored video (MED-030).
  const first = await storedHeaderId(api);
  await openMedia(page);
  await page.getByTestId("media-header-crop").click();
  await expect(start).toHaveAttribute("aria-valuetext", "0,5\u00a0s");
  await expect(end).toHaveAttribute("aria-valuetext", "1,8\u00a0s");
  await start.focus();
  await page.keyboard.press("ArrowRight");
  await dialog.getByTestId("video-crop-poster").check();
  await dialog.getByRole("button", { name: "Appliquer" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("editor-status")).toHaveText("Modifications non enregistrées");
  await saveCard(page);
  const reframed = await api.get(`/api/cards/${aliceCardId}`, { headers: await api.authHeaders("seed-alice") });
  const second = ((await reframed.json()) as { header: { id: string; loop: unknown; poster_time: number } }).header;
  expect(second.id).not.toBe(first);
  expect(second.loop).toEqual({ start: 0.6, end: 1.8 });
  expect(second.poster_time).toBeCloseTo(0.6);
});

/** A 1280 × 720 (16:9) JPEG drawn by the browser: a header photo that is not 4:3. */
async function wideJpeg(page: import("@playwright/test").Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d")!;
    const gradient = context.createLinearGradient(0, 0, 1280, 720);
    gradient.addColorStop(0, "#d9774b");
    gradient.addColorStop(1, "#3366cc");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1280, 720);
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(640, 300, 120, 0, Math.PI * 2);
    context.fill();
    return canvas.toDataURL("image/jpeg", 0.9);
  });
  return Buffer.from(dataUrl.split(",")[1]!, "base64");
}

/** The header media id of Alice's card as stored. */
async function storedHeaderId(api: TestApi): Promise<string | undefined> {
  const response = await api.get(`/api/cards/${aliceCardId}`, { headers: await api.authHeaders("seed-alice") });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { header?: { id: string } | null }).header?.id;
}

test("EDI-026 MED-030 re-framing the header photo", async ({ page, api }) => {
  await openMedia(page);
  const photo = await wideJpeg(page);
  await page.getByTestId("media-header-input").setInputFiles({ name: "large.jpg", mimeType: "image/jpeg", buffer: photo });

  // A 16:9 photo is framed before it is sent.
  const dialog = page.getByRole("dialog", { name: "Recadrer l’en-tête" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("switch", { name: "Afficher les zones couvertes" })).toBeChecked();
  await expect(dialog.getByTestId("covered-zones")).toBeVisible();
  await dialog.getByRole("application").focus();
  await page.keyboard.press("+");
  await expect(dialog.getByRole("slider", { name: "Zoom" })).toHaveAttribute("aria-valuetext", "110\u00a0%");
  await page.keyboard.press("ArrowLeft");
  await dialog.getByRole("button", { name: "Appliquer" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("media-header-current")).toHaveText("Photo");
  await saveCard(page);
  const first = await storedHeaderId(api);
  expect(first).toBeTruthy();

  await page.goto("/c/alice-durand");
  const header = page.getByTestId("card-header-image");
  await expect(header).toBeVisible();
  const ratio = await header.evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight);
  expect(Math.abs(ratio / (4 / 3) - 1)).toBeLessThan(0.01);

  // « Recadrer » makes a new media from the kept source; the card shows it once saved.
  await openMedia(page);
  await page.getByTestId("media-header-crop").click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Réinitialiser" }).click();
  await dialog.getByRole("button", { name: "Appliquer" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("editor-status")).toHaveText("Modifications non enregistrées");
  await saveCard(page);
  const second = await storedHeaderId(api);
  expect(second).toBeTruthy();
  expect(second).not.toBe(first);
});

test("EDI-035 MED-005 cropping the profile photo", async ({ page }) => {
  await openMedia(page);
  await page.getByTestId("media-avatar-input").setInputFiles(fixture("avatar.jpg"));

  // An 800 × 600 photo is not square: the dialog opens by itself, with both preview sizes.
  const dialog = page.getByRole("dialog", { name: "Recadrer la photo de profil" });
  await expect(dialog).toBeVisible();
  // The labelled previews are for the desktop dialog; the phone shows them smaller, without labels.
  if (test.info().project.name === "desktop") {
    await expect(dialog.getByText("Sur la carte · 112 px")).toBeVisible();
    await expect(dialog.getByText("Dans l’app · 36 px")).toBeVisible();
  }
  await dialog.getByRole("application").focus();
  await page.keyboard.press("+");
  await expect(dialog.getByRole("slider", { name: "Zoom" })).toHaveAttribute("aria-valuetext", "110\u00a0%");
  await dialog.getByRole("button", { name: "Appliquer" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("media-avatar-current")).toBeVisible();
  await saveCard(page);

  await page.goto("/c/alice-durand");
  const avatar = page.getByTestId("card-avatar");
  await expect(avatar).toBeVisible();
  await expect.poll(() => avatar.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  const ratio = await avatar.evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight);
  expect(Math.abs(ratio - 1)).toBeLessThan(0.01);

  // « Recadrer » re-frames from the kept source.
  await openMedia(page);
  await page.getByTestId("media-avatar-crop").click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Annuler" }).click();
  await expect(dialog).toBeHidden();
});

test("MED-013 too long video is refused before upload", async ({ page }) => {
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/media")) uploads.push(request.url());
  });
  await openMedia(page);
  await page.getByTestId("media-header-input").setInputFiles(fixture("header-31s.mp4"));
  await expect(page.getByTestId("media-header-error")).toHaveText("La vidéo dépasse 30 secondes");
  expect(uploads).toEqual([]);
  await expect(editorSaveButton(page)).toBeDisabled();
});

test("MED-017 media served through the web origin honours Range", async ({ api }) => {
  const media = await api.uploadMedia(
    "seed-alice",
    aliceCardId,
    "header",
    { name: "header-2s.mp4", mimeType: "video/mp4", buffer: await readFile(fixture("header-2s.mp4")) },
    { name: "poster.jpg", mimeType: "image/jpeg", buffer: await readFile(fixture("avatar.jpg")) },
  );
  expect(media.video_url).toBeTruthy();
  const url = new URL(media.video_url!);
  const response = await api.get(`${WEB_URL}${url.pathname}`, { headers: { range: "bytes=0-99" } });
  expect(response.status()).toBe(206);
  expect(response.headers()["content-range"]).toMatch(/^bytes 0-99\//);
  expect((await response.body()).length).toBe(100);
});

test("MED-012 uploads above 10 MB pass the web rewrite", async ({ api }) => {
  // The video followed by a top-level `free` box of 11 MB: still a valid MP4, but a body above 10 MB.
  const free = Buffer.alloc(11 * 1024 * 1024);
  free.writeUInt32BE(free.length, 0);
  free.write("free", 4, "ascii");
  const video = Buffer.concat([await readFile(fixture("header-2s.mp4")), free]);
  expect(video.length).toBeGreaterThan(10 * 1024 * 1024);

  const response = await api.post(`${WEB_URL}/api/cards/${aliceCardId}/media`, {
    headers: await api.authHeaders("seed-alice"),
    multipart: {
      slot: "header",
      file: { name: "header-11mb.mp4", mimeType: "video/mp4", buffer: video },
      poster: { name: "poster.jpg", mimeType: "image/jpeg", buffer: await readFile(fixture("avatar.jpg")) },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
});

test("MED-018 EDI-006 an unsaved upload does not reach the public page", async ({ page, context }) => {
  await openMedia(page);
  await page.getByTestId("media-avatar-input").setInputFiles(fixture("avatar.jpg"));
  await page.getByTestId("avatar-crop-apply").click();
  await expect(page.getByTestId("media-avatar-current")).toBeVisible();
  await expect(page.getByTestId("editor-status")).toHaveText("Modifications non enregistrées");

  const publicPage = await context.newPage();
  await publicPage.goto("/c/alice-durand");
  await expect(publicPage.getByTestId("card-name")).toBeVisible();
  await expect(publicPage.getByTestId("card-avatar")).toHaveCount(0);
});
