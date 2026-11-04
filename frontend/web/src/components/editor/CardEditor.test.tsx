import { ApiError } from "@cartouche/api-client";
import { configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cardView } from "@/components/cards/card-view.fixture";
import { AppShell } from "@/components/shell/AppShell";
import type { CardView } from "@/lib/cards/types";
import { CardEditor } from "./CardEditor";
import { renderWithIntl } from "./test-helpers";

// The slug check waits 300 ms.
configure({ asyncUtilTimeout: 4000 });

const get = vi.fn();
const put = vi.fn();
const uploadMedia = vi.fn();
const reframeMedia = vi.fn();
vi.mock("@/lib/api", () => ({
  useApi: () => ({ GET: get, PUT: put }),
  useUploadMedia: () => uploadMedia,
  useReframeMedia: () => reframeMedia,
}));
// A 4:3 photo goes up as it is, without the crop dialog (EDI-026).
vi.mock("@/lib/media/image", () => ({ readImageSize: async () => ({ width: 800, height: 600 }) }));
const showToast = vi.fn();
vi.mock("@/lib/toast", () => ({ showToast: (...args: unknown[]) => showToast(...args) }));
const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/cards/0198c8a0-0000-7000-8000-000000000001",
  useRouter: () => ({ push }),
}));

const avatar = {
  id: "0198a1a0-0000-7000-8000-000000000002",
  kind: "image" as const,
  images: [{ width: 256, url: "https://media.example.test/a/s256.webp" }],
  jpeg_url: "https://media.example.test/a/s256.jpg",
};

const card = (overrides: Partial<CardView> = {}) =>
  cardView({
    id: "0198c8a0-0000-7000-8000-000000000001",
    content: { first_name: "Alice", last_name: "Durand", job_title: "Fondatrice", email: "alice@example.test" },
    links: [{ kind: "custom", url: "https://alice.example.test", label: "Portfolio" }],
    ...overrides,
  });

/** The editor inside the dashboard shell, which holds its top bar actions and its phone save bar. */
function renderEditor(value = card()) {
  return renderWithIntl(
    <AppShell user={{ name: "Alice Durand", email: "alice@example.test" }} onSignOut={() => undefined}>
      <CardEditor card={value} />
    </AppShell>,
  );
}

function type(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

const validationFailed = (fields: { field: string; code: string }[]) =>
  new ApiError({ status: 400, code: "validation_failed", message: "Invalid fields.", requestId: "r1", fields });

beforeEach(() => {
  get.mockReset().mockResolvedValue({ data: { status: "current", slug: null } });
  put.mockReset();
  showToast.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("CardEditor", { timeout: 15_000 }, () => {
  test("EDI-003 form and phone preview side by side", () => {
    renderEditor();
    const form = screen.getByRole("form", { name: "Formulaire de la carte" });
    const preview = screen.getByRole("region", { name: "Aperçu de la carte" });
    expect(within(preview).getByTestId("phone-preview")).toBeInTheDocument();
    expect(within(preview).getByText("Brouillon, non publié")).toBeInTheDocument();
    expect(within(preview).getByText(/^L’aperçu suit chaque frappe/).textContent).toBe(
      "L’aperçu suit chaque frappe. Rien n’est publié avant «\u00a0Enregistrer\u00a0».",
    );
    expect(within(form).queryByTestId("phone-preview")).toBeNull();
    // On a computer the columns sit side by side: the form, then a 440 px preview column.
    expect(screen.getByTestId("card-editor").className).toContain("@min-[848px]:grid-cols-[minmax(0,1fr)_440px]");
    // The anchor tabs lead to the sections of the form.
    const tabs = within(screen.getByRole("navigation", { name: "Sections" })).getAllByRole("link");
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute("href")])).toEqual([
      ["Identité", "#section-identity"],
      ["Coordonnées", "#section-contact"],
      ["Liens", "#section-links"],
      ["Médias", "#section-media"],
      ["Apparence", "#section-template"],
    ]);
  });

  test("EDI-003 on a phone Modifier and Aperçu switch views", () => {
    renderEditor();
    const form = screen.getByRole("form", { name: "Formulaire de la carte" });
    const preview = screen.getByRole("region", { name: "Aperçu de la carte" });
    const edit = screen.getByRole("tab", { name: "Modifier" });
    const show = screen.getByRole("tab", { name: "Aperçu" });
    expect(edit).toHaveAttribute("aria-selected", "true");
    expect(form.className).not.toContain("@max-[847px]:hidden");
    expect(preview.className).toContain("@max-[847px]:hidden");

    fireEvent.click(show);
    expect(show).toHaveAttribute("aria-selected", "true");
    expect(edit).toHaveAttribute("aria-selected", "false");
    expect(form.className).toContain("@max-[847px]:hidden");
    expect(preview.className).not.toContain("@max-[847px]:hidden");

    fireEvent.click(edit);
    expect(form.className).not.toContain("@max-[847px]:hidden");
  });

  test("EDI-003 on a phone the sections fold, each with its summary", () => {
    renderEditor(card({ content: { first_name: "Alice", last_name: "Durand", email: "alice@example.test", phone: "+33639984217" } }));
    const identity = screen.getByTestId("editor-section-toggle-identity");
    const contact = screen.getByTestId("editor-section-toggle-contact");
    expect(identity).toHaveAttribute("aria-expanded", "true");
    expect(contact).toHaveAttribute("aria-expanded", "false");
    expect(contact).toHaveTextContent("Coordonnées");
    expect(contact).toHaveTextContent("alice@example.test · +33639984217");
    expect(screen.getByTestId("editor-section-toggle-links")).toHaveTextContent("1 lien libre");
    expect(screen.getByTestId("editor-section-body-contact").className).toContain("@max-[847px]:hidden");

    fireEvent.click(contact);
    expect(contact).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("editor-section-body-contact").className).not.toContain("@max-[847px]:hidden");
    // Folded again, the summary follows the draft.
    type("editor-email", "zoe@example.test");
    fireEvent.click(contact);
    expect(contact).toHaveAttribute("aria-expanded", "false");
    expect(contact).toHaveTextContent("zoe@example.test · +33639984217");
  });

  test("EDI-007 optional fields are marked and the description has its hint", () => {
    renderEditor();
    expect(screen.getByLabelText("Prénom")).toBe(screen.getByTestId("editor-first_name"));
    expect(screen.getByLabelText("Poste (facultatif)")).toBe(screen.getByTestId("editor-job_title"));
    expect(screen.getByTestId("editor-description")).toHaveAccessibleDescription("Deux ou trois lignes s’affichent le mieux.");
  });

  test("EDI-027 the unsaved badge follows the draft", () => {
    renderEditor();
    expect(screen.getByTestId("editor-status")).toBeEmptyDOMElement();
    expect(screen.getByTestId("editor-save-bar")).toBeDisabled();
    type("editor-job_title", "Directrice");
    expect(screen.getByTestId("editor-status")).toHaveTextContent("Modifications non enregistrées");
    expect(screen.getByTestId("editor-status-phone")).toHaveTextContent("Modifications non enregistrées");
    expect(screen.getByTestId("editor-save-bar")).toBeEnabled();
    type("editor-job_title", "Fondatrice");
    expect(screen.getByTestId("editor-status")).toBeEmptyDOMElement();
    expect(screen.getByTestId("editor-status-phone")).toBeEmptyDOMElement();
  });

  test("EDI-027 a refused save lists the fields with links", async () => {
    put.mockRejectedValue(
      validationFailed([
        { field: "links[0].url", code: "invalid_url" },
        { field: "content.email", code: "invalid_email" },
      ]),
    );
    renderEditor();
    type("editor-email", "pas-un-email");
    fireEvent.click(screen.getByTestId("editor-save"));

    const summary = await screen.findByTestId("editor-error-summary");
    expect(summary.textContent).toContain("Rien n’a été enregistré\u00a0: 2 points à corriger.");
    const links = within(summary).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["E-mail", "#editor-email"],
      ["Adresse du lien 1", "#link-url-0"],
    ]);
    expect(screen.getByTestId("editor-error-count")).toHaveTextContent("2 erreurs à corriger");
    // The sections holding an error open on a phone.
    expect(screen.getByTestId("editor-section-toggle-contact")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("editor-section-toggle-links")).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(links[1]!);
    await waitFor(() => expect(screen.getByTestId("link-url-0")).toHaveFocus());

    // Correcting a field takes it out of the summary.
    type("editor-email", "alice@example.test");
    expect(screen.getByTestId("editor-error-summary")).toHaveTextContent("1 point à corriger.");
    expect(screen.getByTestId("editor-error-count")).toHaveTextContent("1 erreur à corriger");
  });

  test("EDI-027 a successful save says Carte enregistrée et publiée", async () => {
    put.mockResolvedValue({ data: card({ content: { first_name: "Alice", job_title: "Directrice" } }) });
    renderEditor();
    type("editor-job_title", "Directrice");
    fireEvent.click(screen.getByTestId("editor-save-bar"));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Carte enregistrée et publiée"));
    expect(screen.getByTestId("editor-status")).toBeEmptyDOMElement();
  });

  test("EDI-027 the top bar shows the public link and the page; the save bar replaces the tab bar", () => {
    renderEditor();
    expect(screen.queryByTestId("tab-cards")).toBeNull();
    expect(screen.getByTestId("editor-save-bar")).toBeInTheDocument();
    const crumbs = screen.getByRole("navigation", { name: "Fil d’Ariane" });
    expect(crumbs).toHaveTextContent("Mes cartes");
    expect(crumbs).toHaveTextContent("Alice Durand");
    expect(screen.getByTestId("editor-slug")).toHaveTextContent("/c/alice-durand");
    expect(screen.getByTestId("shell-title")).toHaveTextContent("Alice Durand");
    expect(screen.getByTestId("editor-public-page")).toHaveAttribute("href", "http://localhost:13000/c/alice-durand");
    expect(screen.getByTestId("editor-public-page")).toHaveAttribute("target", "_blank");
    expect(screen.getByTestId("editor-save")).toBeDisabled();
  });

  test("LNK-036 a blocked card opens read-only", () => {
    renderEditor(card({ status: "disabled_by_support" }));
    expect(screen.getByTestId("editor-blocked")).toHaveTextContent("désactivée par le support");
    expect(within(screen.getByTestId("editor-blocked")).getByRole("link", { name: "Contacter le support" })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:"),
    );
    expect(screen.getByTestId("editor-job_title")).toBeDisabled();
    expect(screen.getByTestId("link-url-0")).toBeDisabled();
    expect(screen.getByTestId("link-handle-0")).toBeDisabled();
    expect(screen.getByTestId("link-remove-0")).toBeDisabled();
    expect(screen.getByTestId("link-add")).toBeDisabled();
    expect(screen.getByTestId("link-add-network")).toBeDisabled();
    expect(screen.getByTestId("slug-input")).toBeDisabled();
    expect(screen.queryByTestId("editor-save")).toBeNull();
    expect(screen.queryByTestId("editor-save-bar")).toBeNull();
    // The preview still works.
    fireEvent.click(screen.getByTestId("simulate-event"));
    expect(within(screen.getByTestId("phone-preview")).getByTestId("event-button-preview")).toBeInTheDocument();
  });

  test("EDI-004 preview updates on each keystroke, with no save", () => {
    renderEditor();
    expect(within(screen.getByTestId("phone-preview")).getByTestId("card-job-title")).toHaveTextContent("Fondatrice");
    type("editor-job_title", "Directrice ✨");
    expect(within(screen.getByTestId("phone-preview")).getByTestId("card-job-title")).toHaveTextContent("Directrice ✨");
    type("editor-first_name", "Éloïse");
    expect(within(screen.getByTestId("phone-preview")).getByTestId("card-name")).toHaveTextContent("Éloïse Durand");
    expect(put).not.toHaveBeenCalled();
  });

  test("EDI-004 links, template settings and theme show in the preview", async () => {
    renderEditor();
    const preview = within(screen.getByTestId("phone-preview"));
    expect(preview.getByTestId("card-link-0")).toHaveTextContent("Portfolio");
    type("link-label-0", "Mon site");
    expect(preview.getByTestId("card-link-0")).toHaveTextContent("Mon site");
    fireEvent.pointerDown(screen.getByTestId("link-add-network"), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Site web" }));
    type("link-url-1", "https://b.example.test");
    // TPL-027: icons by default, a website is an icon named after its kind and its address.
    expect(preview.getByTestId("card-link-1").textContent).toBe("");
    expect(preview.getByTestId("card-link-1")).toHaveAttribute("aria-label", "Site web — b.example.test");

    // TPL-004: a setting of the template changes the preview.
    fireEvent.click(screen.getByRole("radio", { name: "Liste" }));
    expect(preview.getByTestId("card-link-1")).toHaveTextContent("Site web");
    expect(preview.getByTestId("card-link-1")).not.toHaveAttribute("aria-label");

    fireEvent.change(screen.getByTestId("theme-accent"), { target: { value: "#ff0066" } });
    expect(screen.getByTestId("phone-preview").querySelector("article")!.style.getPropertyValue("--c-accent")).toBe("#ff0066");
  });

  test("EDI-005 EDI-017 simulated event only in preview, never in the saved body", async () => {
    put.mockResolvedValue({ data: card() });
    renderEditor();
    expect(screen.queryByTestId("event-button-preview")).toBeNull();
    fireEvent.click(screen.getByTestId("simulate-event"));
    expect(within(screen.getByTestId("phone-preview")).getByTestId("event-button-preview")).toHaveTextContent(
      "Événement de démonstration",
    );

    type("editor-job_title", "Directrice");
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const body = JSON.stringify(put.mock.calls[0]![1].body);
    expect(body).not.toContain("preview");
    expect(body).not.toContain("démonstration");
    expect(body).not.toContain("event");
  });

  test("EDI-006 save sends the whole card, media included, and then the editor is clean", async () => {
    const stored = card({ avatar });
    put.mockResolvedValue({ data: { ...stored, content: { ...stored.content, job_title: "Directrice" } } });
    renderEditor(stored);
    expect(screen.getByTestId("editor-save")).toBeDisabled();

    type("editor-job_title", "Directrice");
    expect(screen.getByTestId("editor-status")).toHaveTextContent("Modifications non enregistrées");
    fireEvent.click(screen.getByTestId("editor-save"));

    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith("/api/cards/{id}", {
      params: { path: { id: stored.id } },
      body: expect.objectContaining({
        slug: "alice-durand",
        template: "classique",
        header_media_id: null,
        avatar_media_id: avatar.id,
        content: expect.objectContaining({ job_title: "Directrice", phone: null }),
        links: [{ kind: "custom", url: "https://alice.example.test", label: "Portfolio" }],
      }),
    });
    expect(screen.getByTestId("editor-save")).toBeDisabled();
  });

  test("EDI-006 MED-018 save is refused while an upload is in flight, then allowed once it ends", async () => {
    // A save landing after the upload committed would delete it as unreferenced and leave a dead media id.
    let finish!: (media: typeof avatar) => void;
    uploadMedia.mockReset().mockReturnValue(new Promise((resolve) => (finish = resolve)));
    put.mockResolvedValue({ data: card({ avatar }) });
    renderEditor();
    type("editor-job_title", "Directrice");
    expect(screen.getByTestId("editor-save")).toBeEnabled();

    fireEvent.change(screen.getByTestId("media-header-input"), {
      target: { files: [new File(["jpeg"], "photo.jpg", { type: "image/jpeg" })] },
    });
    await waitFor(() => expect(uploadMedia).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("editor-save")).toBeDisabled();
    // Enter in a field submits the form without the button.
    fireEvent.submit(screen.getByRole("form", { name: "Formulaire de la carte" }));
    expect(put).not.toHaveBeenCalled();

    finish(avatar);
    await waitFor(() => expect(screen.getByTestId("editor-save")).toBeEnabled());
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![1].body.header_media_id).toBe(avatar.id);
  });

  test("EDI-006 save is allowed again after a failed upload", async () => {
    uploadMedia.mockReset().mockRejectedValue(new Error("boom"));
    renderEditor();
    type("editor-job_title", "Directrice");
    fireEvent.change(screen.getByTestId("media-header-input"), {
      target: { files: [new File(["jpeg"], "photo.jpg", { type: "image/jpeg" })] },
    });
    await waitFor(() => expect(uploadMedia).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("editor-save")).toBeEnabled());
  });

  test("EDI-008 the saved card replaces the draft with what the server stored", async () => {
    const stored = card();
    put.mockResolvedValue({ data: { ...stored, content: { ...stored.content, job_title: "Directrice" } } });
    renderEditor(stored);
    type("editor-job_title", "  Directrice  ");
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(screen.getByTestId("editor-job_title")).toHaveValue("Directrice"));
  });

  test("EDI-015 rejected save keeps the input and shows errors", async () => {
    put.mockRejectedValue(
      validationFailed([
        { field: "links[0].url", code: "invalid_url" },
        { field: "content.email", code: "invalid_email" },
      ]),
    );
    renderEditor();
    type("editor-job_title", "Directrice");
    type("link-url-0", "javascript:alert(1)");
    type("editor-email", "pas-un-email");
    fireEvent.click(screen.getByTestId("editor-save"));

    const urlError = await screen.findByTestId("field-error-links-0-url");
    expect(urlError).toHaveTextContent("Cette adresse n'est pas valide");
    expect(screen.getByTestId("link-url-0")).toHaveAttribute("aria-describedby", urlError.id);
    expect(screen.getByTestId("link-url-0")).toHaveValue("javascript:alert(1)");
    expect(screen.getByTestId("field-error-content-email")).toHaveTextContent("adresse e-mail n'est pas valide");
    expect(screen.getByTestId("editor-email")).toHaveAccessibleDescription(/adresse e-mail n'est pas valide/);
    expect(screen.getByTestId("editor-email")).toHaveValue("pas-un-email");
    expect(screen.getByTestId("editor-job_title")).toHaveValue("Directrice");
    expect(screen.getByTestId("editor-error-summary")).toBeVisible();
    expect(screen.queryByTestId("error-notice")).toBeNull();
    // Still unsaved, and can be saved again once corrected.
    expect(screen.getByTestId("editor-save")).toBeEnabled();
  });

  test("EDI-015 editing a refused field clears its message only", async () => {
    put.mockRejectedValue(
      validationFailed([
        { field: "links[0].url", code: "invalid_url" },
        { field: "content.email", code: "invalid_email" },
      ]),
    );
    renderEditor();
    type("editor-email", "pas-un-email");
    fireEvent.click(screen.getByTestId("editor-save"));
    await screen.findByTestId("field-error-content-email");

    type("editor-email", "alice@example.test");
    expect(screen.queryByTestId("field-error-content-email")).toBeNull();
    expect(screen.getByTestId("field-error-links-0-url")).toBeVisible();
  });

  test("EDI-015 LNK-022 a slug taken at save time is shown under the slug field", async () => {
    put.mockRejectedValue(new ApiError({ status: 409, code: "slug_taken", message: "Taken.", requestId: "r2" }));
    renderEditor();
    type("slug-input", "bob-martin");
    fireEvent.click(screen.getByTestId("editor-save"));
    expect(await screen.findByTestId("field-error-slug")).toHaveTextContent("Ce lien est déjà pris.");
    expect(screen.getByTestId("slug-input")).toHaveValue("bob-martin");
    expect(screen.getByTestId("slug-input")).toHaveAccessibleDescription(/Ce lien est déjà pris/);
  });

  test("EDI-015 a failure with no field shows the generic notice and keeps the input", async () => {
    put.mockRejectedValue(new ApiError({ status: 500, code: "internal_error", message: "Boom.", requestId: "req-9" }));
    renderEditor();
    type("editor-job_title", "Directrice");
    fireEvent.click(screen.getByTestId("editor-save"));
    expect(await screen.findByTestId("error-notice")).toBeVisible();
    expect(screen.getByTestId("error-request-id")).toHaveTextContent("req-9");
    expect(screen.getByTestId("editor-job_title")).toHaveValue("Directrice");
  });

  test("LNK-020 a slug the check refuses cannot be saved", async () => {
    get.mockResolvedValue({ data: { status: "taken", slug: null } });
    renderEditor();
    type("slug-input", "bob-martin");
    await waitFor(() => expect(screen.getByTestId("slug-status")).toHaveAttribute("data-status", "taken"));
    expect(screen.getByTestId("editor-save")).toBeDisabled();
  });

  test("TPL-013 TPL-018 an unreadable theme warns, and the save is stopped in the browser with the summary", () => {
    renderEditor();
    expect(screen.queryByTestId("contrast-text")).toBeNull();
    fireEvent.change(screen.getByTestId("theme-text"), { target: { value: "#ffffff" } });
    expect(screen.getByTestId("contrast-text")).toBeVisible();
    expect(screen.getByTestId("editor-save")).toBeEnabled();

    fireEvent.click(screen.getByTestId("editor-save"));
    expect(put).not.toHaveBeenCalled();
    expect(screen.getByTestId("editor-error-summary")).toHaveTextContent("Rien n’a été enregistré");
    expect(within(screen.getByTestId("editor-error-summary")).getByRole("link", { name: "Thème" })).toBeVisible();
    expect(screen.getByTestId("field-error-theme")).toHaveTextContent("Ces couleurs ne sont pas assez lisibles");

    // Fixing the colour clears the message; the save then goes through.
    fireEvent.click(screen.getByTestId("contrast-fix-text"));
    expect(screen.queryByTestId("editor-error-summary")).toBeNull();
  });

  test("EDI-030 the summary of the theme section says personnalisé after a change", () => {
    renderEditor();
    const section = screen.getByTestId("editor-section-theme");
    expect(section).toHaveTextContent("Craie");
    expect(section).not.toHaveTextContent("personnalisé");
    fireEvent.change(screen.getByTestId("theme-accent"), { target: { value: "#ff0066" } });
    expect(section).toHaveTextContent("Craie, personnalisé");
  });

  test("EDI-007 LNK-036 a blocked card has its sliders and segmented controls disabled", () => {
    renderEditor(card({ status: "disabled_by_support" }));
    expect(screen.getByRole("slider", { name: "Intensité du dégradé de l’en-tête" })).toHaveAttribute("data-disabled");
    expect(screen.getByRole("radio", { name: "Liste" })).toBeDisabled();
  });

  test("EDI-016 leaving with unsaved changes asks first", () => {
    renderEditor();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    type("editor-job_title", "Directrice");
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  /** Clicks the link and tells whether its own handler let the navigation go; the navigation itself is stopped. */
  function backNavigates(testId = "editor-back"): boolean {
    let allowed = false;
    const stop = (event: Event) => {
      allowed = !event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener("click", stop);
    fireEvent.click(screen.getByTestId(testId));
    document.removeEventListener("click", stop);
    return allowed;
  }

  const dialog = () => screen.queryByRole("alertdialog");

  test("EDI-016 EDI-028 the back link opens the leave dialog only when there are unsaved changes", () => {
    renderEditor();
    expect(backNavigates()).toBe(true);
    expect(dialog()).toBeNull();

    type("editor-job_title", "Directrice");
    expect(backNavigates()).toBe(false);
    expect(dialog()).toHaveTextContent("Tu as modifié la carte de Alice Durand.");
    fireEvent.click(screen.getByRole("button", { name: "Rester" }));
    expect(dialog()).toBeNull();
    expect(push).not.toHaveBeenCalled();

    expect(backNavigates()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Quitter sans enregistrer" }));
    expect(push).toHaveBeenCalledWith("/dashboard");
  });

  test("EDI-028 Enregistrer et quitter leaves only after the save", async () => {
    put.mockResolvedValue({ data: card({ content: { first_name: "Alice", last_name: "Durand", job_title: "Directrice" } }) });
    renderEditor();
    type("editor-job_title", "Directrice");
    backNavigates();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer et quitter" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    expect(put).toHaveBeenCalledTimes(1);
  });

  test("EDI-028 a refused save closes the dialog, shows the errors and does not leave", async () => {
    put.mockRejectedValue(validationFailed([{ field: "content.email", code: "invalid_email" }]));
    renderEditor();
    type("editor-job_title", "Directrice");
    backNavigates();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer et quitter" }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByTestId("editor-error-count")).toBeInTheDocument();
  });

  test("EDI-016 a link outside the editor, such as the page header, opens the dialog too", () => {
    renderEditor();
    const header = document.body.appendChild(document.createElement("a"));
    header.href = "/account";
    header.dataset.testid = "outside-link";
    type("editor-job_title", "Directrice");
    expect(backNavigates("outside-link")).toBe(false);
    expect(dialog()).not.toBeNull();
    header.remove();
  });

  test("EDI-018 the events of the card are one link away, which also asks before leaving unsaved changes", () => {
    renderEditor();
    expect(screen.getByTestId("editor-events")).toHaveAttribute(
      "href",
      "/dashboard/cards/0198c8a0-0000-7000-8000-000000000001/events",
    );
    expect(screen.getByTestId("editor-events")).toHaveTextContent("Événements");
    expect(backNavigates("editor-events")).toBe(true);

    type("editor-job_title", "Directrice");
    expect(backNavigates("editor-events")).toBe(false);
    expect(dialog()).not.toBeNull();
  });

  test("EDI-016 reverting a setting leaves the editor clean", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("radio", { name: "Liste" }));
    expect(screen.getByTestId("editor-status")).toHaveTextContent("Modifications non enregistrées");
    fireEvent.click(screen.getByRole("radio", { name: "Icônes" }));
    expect(screen.getByTestId("editor-status")).toBeEmptyDOMElement();
    expect(screen.getByTestId("editor-save")).toBeDisabled();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  test("EDI-016 after a save the editor no longer asks", async () => {
    put.mockResolvedValue({ data: card({ content: { first_name: "Alice", job_title: "Directrice" } }) });
    renderEditor();
    type("editor-job_title", "Directrice");
    fireEvent.click(screen.getByTestId("editor-save"));
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  test("EDI-015 the slots of the header and the profile photo show their refusal", async () => {
    put.mockRejectedValue(validationFailed([{ field: "avatar_media_id", code: "invalid_media" }]));
    renderEditor();
    type("editor-job_title", "Directrice");
    fireEvent.click(screen.getByTestId("editor-save"));
    expect(await within(screen.getByTestId("media-slot")).findByTestId("field-error-avatar-media-id")).toBeVisible();
  });
});
