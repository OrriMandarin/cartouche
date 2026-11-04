import { editorSaveButton, expect, openEditorSection, saveCard, showEditorView, test } from "../fixtures";

let aliceCardId: string;

test.beforeEach(async ({ api, loginAs }) => {
  const { cards } = await api.seed("cards");
  const alice = cards.find((card) => card.slug === "alice-durand");
  if (!alice) throw new Error("the cards scenario has no alice-durand card");
  aliceCardId = alice.id;
  await loginAs("seed-alice");
});

const editorUrl = () => `/dashboard/cards/${aliceCardId}`;

const TAKEN = "Ce lien est déjà pris. Choisis-en un autre ou prends une suggestion\u00a0:";

test("EDI-003 form and preview side by side on a computer, Modifier and Aperçu tabs on a phone", async ({ page }) => {
  await page.goto(editorUrl());
  const form = page.getByRole("form", { name: "Formulaire de la carte" });
  const preview = page.getByTestId("phone-preview");
  const wide = (page.viewportSize()?.width ?? 0) >= 1024;
  if (wide) {
    await expect(page.getByRole("tab", { name: "Aperçu" })).toBeHidden();
    const formBox = await form.boundingBox();
    const previewBox = await preview.boundingBox();
    expect(previewBox!.x).toBeGreaterThanOrEqual(formBox!.x + formBox!.width);
    await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link")).toHaveText([
      "Identité",
      "Coordonnées",
      "Liens",
      "Médias",
      "Apparence",
    ]);
  } else {
    await expect(form).toBeVisible();
    await expect(preview).toBeHidden();
    await page.getByRole("tab", { name: "Aperçu" }).click();
    await expect(preview).toBeVisible();
    await expect(form).toBeHidden();
    await page.getByRole("tab", { name: "Modifier" }).click();
    await expect(form).toBeVisible();
    // The sections fold, with a summary; Identité is open.
    await expect(page.getByTestId("editor-section-toggle-identity")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("editor-section-toggle-contact")).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("editor-section-body-contact")).toBeHidden();
    await expect(page.getByTestId("editor-save-bar")).toBeVisible();
  }
});

test("EDI-004 EDI-006 preview is live, public page changes only on save", async ({ page, context }) => {
  await page.goto(editorUrl());
  const preview = page.getByTestId("phone-preview");
  await expect(preview.getByTestId("card-job-title")).toHaveText("Fondatrice");

  await page.getByTestId("editor-job_title").fill("Directrice");
  await expect(preview.getByTestId("card-job-title")).toHaveText("Directrice");

  const publicPage = await context.newPage();
  await publicPage.goto("/c/alice-durand");
  await expect(publicPage.getByTestId("card-job-title")).toHaveText("Fondatrice");

  await saveCard(page);
  await publicPage.reload();
  await expect(publicPage.getByTestId("card-job-title")).toHaveText("Directrice");
});

test("EDI-005 EDI-017 simulated event never reaches the public page", async ({ page, context }) => {
  await page.goto(editorUrl());
  const preview = page.getByTestId("phone-preview");
  await expect(preview.getByTestId("card-name")).toHaveText("Alice Durand");
  await expect(preview.locator('[data-testid^="event-button-"]')).toHaveCount(0);

  await showEditorView(page, "Aperçu");
  await page.getByTestId("simulate-event").click();
  await expect(preview.getByTestId("event-button-preview").getByTestId("card-event-name")).toHaveText(
    "Événement de démonstration",
  );

  await showEditorView(page, "Modifier");
  await page.getByTestId("editor-job_title").fill("Directrice");
  await saveCard(page);
  // The simulated event stays in the preview (the switch is still on), not in the saved card.
  await showEditorView(page, "Aperçu");
  await expect(preview.getByTestId("event-button-preview")).toBeVisible();

  const publicPage = await context.newPage();
  await publicPage.goto("/c/alice-durand");
  await expect(publicPage.getByTestId("card-job-title")).toHaveText("Directrice");
  await expect(publicPage.locator('[data-testid^="event-button-"]')).toHaveCount(0);
});

test("EDI-015 PUB-022 invalid link is refused next to its field", async ({ page, context }) => {
  await page.goto(editorUrl());
  await page.getByTestId("editor-job_title").fill("Directrice");
  await openEditorSection(page, "links");
  await page.getByTestId("link-url-0").fill("javascript:alert(1)");
  await editorSaveButton(page).click();

  const error = page.getByTestId("field-error-links-0-url");
  await expect(error).toBeVisible();
  await expect(page.getByTestId("link-url-0")).toHaveAccessibleDescription(await error.innerText());
  await expect(page.getByTestId("link-url-0")).toHaveValue("javascript:alert(1)");
  await expect(page.getByTestId("editor-job_title")).toHaveValue("Directrice");

  // All or nothing: the valid job title was not saved either.
  const publicPage = await context.newPage();
  await publicPage.goto("/c/alice-durand");
  await expect(publicPage.getByTestId("card-job-title")).toHaveText("Fondatrice");
  await expect(publicPage.getByTestId("card-link-0")).toHaveAttribute("href", "https://www.linkedin.com/in/alice");

  // Correcting the link clears the message and the card can be saved.
  await page.getByTestId("link-url-0").fill("https://www.linkedin.com/in/alice-d");
  await expect(error).toHaveCount(0);
  await saveCard(page);
});

test("LNK-020 LNK-022 a slug taken by someone else is flagged and cannot be saved", async ({ page }) => {
  await page.goto(editorUrl());
  await page.getByTestId("slug-input").fill("dan-moreau");
  await expect(page.getByTestId("slug-status")).toHaveText(TAKEN);
  // The check already tells; the save button waits for a free slug.
  await expect(editorSaveButton(page)).toBeDisabled();
});

test("LNK-003 changing the slug keeps the old link working", async ({ page }) => {
  await page.goto(editorUrl());
  await page.getByTestId("slug-input").fill("alice-d");
  await expect(page.getByTestId("slug-status")).toHaveText("Ce lien est disponible.");
  await saveCard(page);

  await page.goto("/c/alice-durand");
  await expect(page).toHaveURL(/\/c\/alice-d$/);
  await expect(page.getByTestId("card-name")).toHaveText("Alice Durand");
});

test("TPL-004 template setting shows in the preview", async ({ page }) => {
  await page.goto(editorUrl());
  const link = page.getByTestId("phone-preview").getByTestId("card-link-0");
  await expect(link).toHaveText("");
  await expect(link).toHaveAttribute("aria-label", "LinkedIn — linkedin.com/in/alice");

  await openEditorSection(page, "template");
  await page.getByTestId("setting-links_layout").click();
  await page.getByRole("option", { name: "Liste" }).click();
  await expect(link).toContainText("LinkedIn");
  await expect(link).toContainText("linkedin.com/in/alice");
  await expect(link).not.toHaveAttribute("aria-label");
});

test("TPL-027 the editor offers Icônes and Liste, Icônes by default", async ({ page }) => {
  await page.goto(editorUrl());
  await openEditorSection(page, "template");
  const layout = page.getByTestId("setting-links_layout");
  await expect(layout).toHaveText("Icônes");
  await layout.click();
  await expect(page.getByRole("option")).toHaveText(["Icônes", "Liste"]);
});

test("TPL-013 TPL-023 a low contrast warns in the editor and the save is refused", async ({
  page,
}) => {
  await page.goto(editorUrl());
  await expect(page.getByTestId("contrast-warning")).toHaveCount(0);
  await openEditorSection(page, "theme");
  await page.getByTestId("theme-text").fill("#ffffff");
  await expect(page.getByTestId("contrast-warning")).toBeVisible();
  await expect(editorSaveButton(page)).toBeEnabled();
  const refused = page.waitForResponse(
    (res) => res.request().method() === "PUT" && res.url().includes("/api/cards/"),
  );
  await editorSaveButton(page).click();
  expect((await refused).status()).toBe(400);
  await expect(page.getByText("Ces couleurs ne sont pas assez lisibles\u00a0: corrige-les pour enregistrer la carte.")).toBeVisible();
});

test("EDI-016 reload with unsaved changes asks for confirmation", async ({ page }) => {
  await page.goto(editorUrl());
  await page.getByTestId("editor-job_title").fill("Directrice");

  const asked = page.waitForEvent("dialog");
  void page.reload().catch(() => undefined);
  const dialog = await asked;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();

  // Staying keeps what was typed.
  await expect(page.getByTestId("editor-job_title")).toHaveValue("Directrice");
});

test("EDI-016 the back link asks before leaving with unsaved changes", async ({ page }) => {
  // The breadcrumb on a computer, the app bar on a phone.
  const back = page.locator('[data-testid="editor-back"]:visible, [data-testid="shell-back"]:visible');
  await page.goto(editorUrl());
  await back.click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto(editorUrl());
  await page.getByTestId("editor-job_title").fill("Directrice");
  page.once("dialog", (dialog) => void dialog.dismiss());
  await back.click();
  await expect(page).toHaveURL(editorUrl());
  await expect(page.getByTestId("editor-job_title")).toHaveValue("Directrice");

  page.once("dialog", (dialog) => void dialog.accept());
  await back.click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("EDI-027 save feedback", async ({ page, context }) => {
  await page.goto(editorUrl());
  const unsaved = page.getByText("Modifications non enregistrées", { exact: true }).locator("visible=true");
  await expect(unsaved).toHaveCount(0);
  await expect(page.getByTestId("editor-slug")).toHaveText("/c/alice-durand");

  await openEditorSection(page, "contact");
  await page.getByTestId("editor-email").fill("alice@example");
  await expect(unsaved).toBeVisible();
  await editorSaveButton(page).click();

  // Nothing saved: the summary counts the points to fix and links to each field.
  const summary = page.getByTestId("editor-error-summary");
  await expect(summary).toContainText("Rien n’a été enregistré\u00a0: 1 point à corriger.");
  if (await page.getByTestId("editor-error-count").isVisible()) {
    await expect(page.getByTestId("editor-error-count")).toHaveText("1 erreur à corriger");
  }
  await page.getByTestId("editor-job_title").focus();
  await summary.getByRole("link", { name: "E-mail" }).click();
  await expect(page.getByTestId("editor-email")).toBeFocused();
  await expect(page.getByTestId("field-error-content-email")).toBeVisible();

  const publicPage = await context.newPage();
  await publicPage.goto("/c/alice-durand");
  await expect(publicPage.getByTestId("card-name")).toHaveText("Alice Durand");

  // Fixed and saved: a toast confirms, the badges go.
  await page.getByTestId("editor-email").fill("bonjour@alice.example.test");
  await expect(summary).toHaveCount(0);
  await saveCard(page);
  await expect(unsaved).toHaveCount(0);
  await expect(page.getByTestId("editor-error-count")).toHaveCount(0);
  await publicPage.reload();
  await expect(publicPage.getByText("bonjour@alice.example.test")).toBeVisible();
});

test("ACC-017 the card of another user is not found", async ({ page, loginAs }) => {
  await loginAs("seed-bob");
  await page.goto(editorUrl());
  await expect(page.getByTestId("card-not-found")).toHaveText("Carte introuvable");
  await expect(page.getByTestId("card-editor")).toHaveCount(0);
});
