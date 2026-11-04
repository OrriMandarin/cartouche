import { readFile } from "node:fs/promises";
import { expect, test } from "../fixtures";
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

async function save(page: import("@playwright/test").Page) {
  await page.getByTestId("editor-save").click();
  await expect(page.getByTestId("editor-status")).toHaveText("Modifications enregistrées");
}

test("MED-005 MED-006 PUB-014 avatar is cropped, published as WebP and in the vCard", async ({ page, api }) => {
  await page.goto(editorUrl());
  await page.getByTestId("media-avatar-input").setInputFiles(fixture("avatar.jpg"));
  await page.getByTestId("avatar-crop-confirm").click();
  await expect(page.getByTestId("media-avatar-current")).toBeVisible();
  await expect(page.getByTestId("phone-preview").getByTestId("card-avatar")).toBeVisible();
  await save(page);

  await page.goto("/c/alice-durand");
  const avatar = page.getByTestId("card-avatar");
  await expect(avatar).toBeVisible();
  expect(await avatar.getAttribute("srcset")).toContain(".webp");

  const vcard = await api.get("/api/public/cards/alice-durand/vcard");
  expect(vcard.ok()).toBe(true);
  expect(await vcard.text()).toContain("PHOTO;ENCODING=b;TYPE=JPEG:");
});

test("MED-003 PUB-005 PUB-006 header video with captured poster", async ({ page }) => {
  await page.goto(editorUrl());
  await page.getByTestId("media-header-input").setInputFiles(fixture("header-2s.mp4"));
  await expect(page.getByTestId("media-header-current")).toContainText("vidéo");
  await save(page);

  await page.goto("/c/alice-durand");
  const video = page.getByTestId("card-header-video");
  await expect(video).toBeVisible();
  expect(await video.getAttribute("poster")).toMatch(/\.webp$/);
  await expect(video).toHaveJSProperty("muted", true);
  await expect(video).toHaveJSProperty("loop", false);
  await expect(video).toHaveAttribute("playsinline", "");
});

test("MED-013 too long video is refused before upload", async ({ page }) => {
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/media")) uploads.push(request.url());
  });
  await page.goto(editorUrl());
  await page.getByTestId("media-header-input").setInputFiles(fixture("header-31s.mp4"));
  await expect(page.getByTestId("media-header-error")).toHaveText("La vidéo dépasse 30 secondes");
  expect(uploads).toEqual([]);
  await expect(page.getByTestId("editor-save")).toBeDisabled();
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
  await page.goto(editorUrl());
  await page.getByTestId("media-avatar-input").setInputFiles(fixture("avatar.jpg"));
  await page.getByTestId("avatar-crop-confirm").click();
  await expect(page.getByTestId("media-avatar-current")).toBeVisible();
  await expect(page.getByTestId("editor-status")).toHaveText("Modifications non enregistrées");

  const publicPage = await context.newPage();
  await publicPage.goto("/c/alice-durand");
  await expect(publicPage.getByTestId("card-name")).toBeVisible();
  await expect(publicPage.getByTestId("card-avatar")).toHaveCount(0);
});
