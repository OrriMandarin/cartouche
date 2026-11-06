import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { MEDIA_URL } from "../env";
import { expect, saveCard, openEditorSection, test, type TestApi } from "../fixtures";

const fixture = (name: string) => new URL(`../fixtures/${name}`, import.meta.url).pathname;
const IMMUTABLE = "public, max-age=31536000, immutable";
/** How long the stack's media origin is made to wait in the loader tests. */
const SLOW_MEDIA_MS = 1500;

let aliceCardId: string;

test.beforeEach(async ({ api, loginAs }) => {
  const { cards } = await api.seed("cards");
  const alice = cards.find((card) => card.slug === "alice-durand");
  if (!alice) throw new Error("the cards scenario has no alice-durand card");
  aliceCardId = alice.id;
  await loginAs("seed-alice");
});

async function openMedia(page: Page) {
  await page.goto(`/dashboard/cards/${aliceCardId}`);
  await openEditorSection(page, "media");
}

/** Loads only the metadata of a video in the page and reads its duration and frame size. */
function videoMetadata(page: Page, url: string) {
  return page.evaluate(
    (src) =>
      new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
        const el = document.createElement("video");
        el.preload = "metadata";
        el.onloadedmetadata = () => resolve({ duration: el.duration, width: el.videoWidth, height: el.videoHeight });
        el.onerror = () => reject(new Error(`${src} does not load`));
        el.src = src;
      }),
    url,
  );
}

async function headerOf(api: TestApi) {
  const response = await api.get(`/api/cards/${aliceCardId}`, { headers: await api.authHeaders("seed-alice") });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { header: { id: string; video_url?: string; source?: { url: string }; images: { url: string }[] } }).header;
}

/** Gives Alice's card the 4:3 test photo as header and as profile photo (the server crops the avatar). */
async function giveAliceImages(api: TestApi) {
  const buffer = await readFile(fixture("avatar.jpg"));
  const file = { name: "avatar.jpg", mimeType: "image/jpeg", buffer };
  const header = await api.uploadMedia("seed-alice", aliceCardId, "header", file);
  const avatar = await api.uploadMedia("seed-alice", aliceCardId, "avatar", file);
  await api.updateCard("seed-alice", aliceCardId, { header_media_id: header.id, avatar_media_id: avatar.id });
}

async function giveAliceVideo(api: TestApi) {
  const media = await api.uploadMedia("seed-alice", aliceCardId, "header", {
    name: "header-2s.mp4",
    mimeType: "video/mp4",
    buffer: await readFile(fixture("header-2s.mp4")),
  });
  await api.updateCard("seed-alice", aliceCardId, { header_media_id: media.id });
}

/** Answers every request to the media origin after `ms`, or refuses it when `ms` is `"abort"`. */
async function slowMedia(page: Page, ms: number | "abort") {
  await page.route(`${MEDIA_URL}/**`, async (route) => {
    if (ms === "abort") return route.abort();
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

test("MED-012 MED-015 EDI-026 a 24-megapixel photo goes through the editor", async ({ page }) => {
  test.setTimeout(90_000);
  await openMedia(page);
  await page.getByTestId("media-header-input").setInputFiles(fixture("photo-24mpx.jpg"));

  // A 3:2 photo is framed before it is sent.
  const dialog = page.getByRole("dialog", { name: "Recadrer l’en-tête" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "Appliquer" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("media-header-current")).toHaveText("Photo", { timeout: 60_000 });
  await saveCard(page);

  await page.goto("/c/alice-durand");
  const header = page.getByTestId("card-header-image");
  await expect(header).toBeVisible();
  const srcset = (await header.getAttribute("srcset")) ?? "";
  for (const width of ["750w", "1125w", "1440w"]) expect(srcset).toContain(width);
  for (const candidate of srcset.split(",")) expect(candidate.trim().startsWith(`${MEDIA_URL}/`)).toBe(true);
  await expect.poll(() => header.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  const ratio = await header.evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight);
  expect(Math.abs(ratio / (4 / 3) - 1)).toBeLessThan(0.01);
});

test("MED-034 MED-035 a 16:9 video is framed and served 1280 × 960", async ({ page }) => {
  test.setTimeout(90_000);
  await openMedia(page);
  await page.getByTestId("media-header-input").setInputFiles(fixture("header-1080p.mp4"));

  const dialog = page.getByTestId("video-crop-dialog");
  await expect(dialog).toBeVisible();
  const end = dialog.getByRole("slider", { name: "Fin de l’extrait" });
  await end.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(end).toHaveAttribute("aria-valuetext", "2,0\u00a0s");
  await dialog.getByRole("button", { name: "Appliquer" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("media-header-current")).toContainText("Vidéo", { timeout: 60_000 });
  await saveCard(page);

  await page.goto("/c/alice-durand");
  const video = page.getByTestId("card-header-video");
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.videoWidth)).toBe(1280);
  expect(await video.evaluate((el: HTMLVideoElement) => el.videoHeight)).toBe(960);
  // The loop (2 s of the 4 s video) is in the file (MED-034).
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => (Number.isFinite(el.duration) ? el.duration : 0))).toBeGreaterThan(0);
  const duration = await video.evaluate((el: HTMLVideoElement) => el.duration);
  expect(duration).toBeGreaterThan(1.85);
  expect(duration).toBeLessThan(2.15);
  const poster = (await video.getAttribute("poster")) ?? "";
  expect(poster.startsWith(`${MEDIA_URL}/`)).toBe(true);
  expect(poster.endsWith(".webp")).toBe(true);
});

test("MED-038 neither the served file nor the edit copy carries a sound track", async ({ api }) => {
  const media = await api.uploadMedia("seed-alice", aliceCardId, "header", {
    name: "header-1080p.mp4",
    mimeType: "video/mp4",
    buffer: await readFile(fixture("header-1080p.mp4")),
  });
  await api.updateCard("seed-alice", aliceCardId, { header_media_id: media.id });
  const header = await headerOf(api);

  // The uploaded file has an AAC track; a `soun` handler would be the mark of an audio track in the output.
  expect((await readFile(fixture("header-1080p.mp4"))).includes("soun")).toBe(true);
  const served = await api.get(header.video_url!);
  expect(served.status()).toBe(200);
  expect((await served.body()).includes("soun")).toBe(false);
  const source = await api.get(header.source!.url);
  expect(source.status()).toBe(200);
  expect((await source.body()).includes("soun")).toBe(false);
});

test("MED-026 EDI-034 applying the crop as soon as the dialog opens still sends a 4:3 crop", async ({ page }) => {
  test.setTimeout(90_000);
  await openMedia(page);
  await page.getByTestId("media-header-input").setInputFiles(fixture("header-1080p.mp4"));

  // No wait: the crop area react-easy-crop reports before the video's metadata must not be sent.
  const dialog = page.getByTestId("video-crop-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Appliquer" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("media-header-current")).toContainText("Vidéo", { timeout: 60_000 });
  await saveCard(page);

  await page.goto("/c/alice-durand");
  const video = page.getByTestId("card-header-video");
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.videoWidth)).toBe(1280);
  expect(await video.evaluate((el: HTMLVideoElement) => el.videoHeight)).toBe(960);
});

test("MED-043 the served files carry their type, cache and inline disposition", async ({ api }) => {
  const video = await api.uploadMedia("seed-alice", aliceCardId, "header", {
    name: "header-2s.mp4",
    mimeType: "video/mp4",
    buffer: await readFile(fixture("header-2s.mp4")),
  });
  const image = await api.uploadMedia("seed-alice", aliceCardId, "avatar", {
    name: "avatar.jpg",
    mimeType: "image/jpeg",
    buffer: await readFile(fixture("avatar.jpg")),
  });

  const videoResponse = await api.get(video.video_url!);
  expect(videoResponse.status()).toBe(200);
  expect(videoResponse.headers()["content-type"]).toBe("video/mp4");
  expect(videoResponse.headers()["cache-control"]).toBe(IMMUTABLE);
  expect(videoResponse.headers()["content-disposition"]).toBe("inline");

  // Both medias are attached: the owner's card exposes the edit copy, and an unused upload is not kept.
  await api.updateCard("seed-alice", aliceCardId, { header_media_id: video.id, avatar_media_id: image.id });
  const sourceResponse = await api.get((await headerOf(api)).source!.url);
  expect(sourceResponse.status()).toBe(200);
  expect(sourceResponse.headers()["content-type"]).toBe("video/mp4");
  expect(sourceResponse.headers()["cache-control"]).toBe(IMMUTABLE);
  expect(sourceResponse.headers()["content-disposition"]).toBe("inline");

  const imageResponse = await api.get(image.images.at(-1)!.url);
  expect(imageResponse.status()).toBe(200);
  expect(imageResponse.headers()["content-type"]).toBe("image/webp");
  expect(imageResponse.headers()["cache-control"]).toBe(IMMUTABLE);
  expect(imageResponse.headers()["content-disposition"]).toBe("inline");

  expect(image.jpeg_url).not.toBeNull();
  const jpegResponse = await api.get(image.jpeg_url!);
  expect(jpegResponse.status()).toBe(200);
  expect(jpegResponse.headers()["content-type"]).toBe("image/jpeg");
  expect(jpegResponse.headers()["cache-control"]).toBe(IMMUTABLE);
  expect(jpegResponse.headers()["content-disposition"]).toBe("inline");
});

test("MED-037 the owner's edit copy is the whole video", async ({ page, api }) => {
  const media = await api.uploadMedia(
    "seed-alice",
    aliceCardId,
    "header",
    { name: "header-1080p.mp4", mimeType: "video/mp4", buffer: await readFile(fixture("header-1080p.mp4")) },
    { loop: { start: 1, end: 3 } },
  );
  await api.updateCard("seed-alice", aliceCardId, { header_media_id: media.id });

  const header = await headerOf(api);
  const sourceUrl = header.source!.url;
  expect(sourceUrl.startsWith(`${MEDIA_URL}/`)).toBe(true);
  expect(sourceUrl).toMatch(/source-[0-9a-f]{32}\.mp4$/);
  const source = await api.get(header.source!.url);
  expect(source.status()).toBe(200);

  // The edit copy keeps the whole 4 s video and its 16:9 frame, its longer side cut to 960 pixels; the served file
  // keeps the 2 s loop.
  await page.goto("/c/alice-durand");
  const edit = await videoMetadata(page, header.source!.url);
  expect(edit.duration).toBeGreaterThan(3.5);
  expect([edit.width, edit.height]).toEqual([960, 540]);
  const served = await videoMetadata(page, header.video_url!);
  expect(served.duration).toBeGreaterThan(1.85);
  expect(served.duration).toBeLessThan(2.15);

  // The public card never exposes it.
  const publicCard = await api.get("/api/public/cards/alice-durand");
  expect(publicCard.ok()).toBe(true);
  expect(await publicCard.text()).not.toContain("source-");
});

test("PUB-006 PUB-039 PUB-040 loaders show while the media load and then go", async ({ page, api }) => {
  await giveAliceImages(api);
  await slowMedia(page, SLOW_MEDIA_MS);
  await page.goto("/c/alice-durand", { waitUntil: "commit" });
  const header = page.locator(".cc-media");
  const avatar = page.locator(".cc-avatar");
  for (const media of [header, avatar]) {
    await expect(media).toHaveAttribute("aria-busy", "true");
    await expect(media.locator(".cc-shimmer")).toHaveCount(1);
  }
  for (const media of [header, avatar]) {
    await expect(media).toHaveAttribute("aria-busy", "false");
    await expect(media.locator(".cc-shimmer")).toHaveCount(0);
  }
  await expect(page.getByTestId("card-header-image")).toBeVisible();
});

test("PUB-006 the video placeholder shows the loader until the video can play", async ({ page, api }) => {
  await giveAliceVideo(api);
  // Only the video file waits: the placeholder image is there to be blurred under the sheen.
  await page.route(`${MEDIA_URL}/**/video.mp4`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, SLOW_MEDIA_MS));
    await route.continue();
  });
  await page.goto("/c/alice-durand", { waitUntil: "commit" });
  const header = page.locator(".cc-media");
  await expect(header).toHaveAttribute("aria-busy", "true");
  await expect(header.locator(".cc-shimmer")).toHaveCount(1);
  await expect(header).toHaveAttribute("aria-busy", "false");
  await expect(header.locator(".cc-shimmer")).toHaveCount(0);
});

test("PUB-039 PUB-040 a media that fails to load leaves no loader", async ({ page, api }) => {
  await giveAliceImages(api);
  await slowMedia(page, "abort");
  await page.goto("/c/alice-durand");
  for (const media of [page.locator(".cc-media"), page.locator(".cc-avatar")]) {
    await expect(media).toHaveClass(/is-failed/);
    await expect(media).toHaveAttribute("aria-busy", "false");
    await expect(media.locator(".cc-shimmer")).toHaveCount(0);
  }
  // Nothing hides the surface colour behind a loader: the card itself is still there.
  await expect(page.getByTestId("card-name")).toHaveText("Alice Durand");
});

test("PUB-006 PUB-041 a video that fails to load leaves no loader", async ({ page, api }) => {
  await giveAliceVideo(api);
  await page.route(`${MEDIA_URL}/**/video.mp4`, (route) => route.abort());
  await page.goto("/c/alice-durand");
  const header = page.locator(".cc-media");
  await expect(header).toHaveAttribute("aria-busy", "false");
  await expect(header.locator(".cc-shimmer")).toHaveCount(0);
  await expect(header.locator(".is-blur")).toHaveCount(0);
  // The placeholder image stays, sharp.
  await expect(header.locator("img.cc-media-el")).toHaveCount(1);
});

test("PUB-041 a cached media is not shown as loading after a reload", async ({ page, api }) => {
  await giveAliceImages(api);
  await page.goto("/c/alice-durand");
  await expect(page.locator(".cc-media")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".cc-avatar")).toHaveAttribute("aria-busy", "false");

  // The images are cached and finish loading before the scripts do: the page must read that on mount.
  await page.route("**/_next/static/**/*.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.reload();
  for (const media of [page.locator(".cc-media"), page.locator(".cc-avatar")]) {
    await expect(media).toHaveAttribute("aria-busy", "false");
    await expect(media.locator(".cc-shimmer")).toHaveCount(0);
  }
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("PUB-042 without JavaScript no sheen is shown", async ({ page, api }) => {
    await giveAliceImages(api);
    await slowMedia(page, SLOW_MEDIA_MS);
    await page.goto("/c/alice-durand", { waitUntil: "commit" });
    // The server renders the loading state; the sheen is in the HTML but hidden (and the image keeps loading).
    for (const sheen of [page.locator(".cc-media .cc-shimmer"), page.locator(".cc-avatar .cc-shimmer")]) {
      await expect(sheen).toHaveCount(1);
      await expect(sheen).toBeHidden();
    }
  });

  test("PUB-042 a video placeholder is not blurred without JavaScript", async ({ page, api }) => {
    await giveAliceVideo(api);
    await page.goto("/c/alice-durand");
    const placeholder = page.locator(".cc-media-el.is-blur");
    await expect(placeholder).toHaveCount(1);
    expect(await placeholder.evaluate((el) => getComputedStyle(el).filter)).toBe("none");
    await expect(page.locator(".cc-shimmer")).toHaveCount(1);
    await expect(page.locator(".cc-shimmer")).toBeHidden();
  });
});
