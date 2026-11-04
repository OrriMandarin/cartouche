import { ApiError } from "@cartouche/api-client";
import { configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cardView } from "@/components/cards/card-view.fixture";
import type { CardView } from "@/lib/cards/types";
import { CardEditor } from "./CardEditor";
import { chooseOption, renderWithIntl } from "./test-helpers";

// The slug check waits 300 ms.
configure({ asyncUtilTimeout: 4000 });

const get = vi.fn();
const put = vi.fn();
const uploadMedia = vi.fn();
vi.mock("@/lib/api", () => ({ useApi: () => ({ GET: get, PUT: put }), useUploadMedia: () => uploadMedia }));

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

function renderEditor(value = card()) {
  return renderWithIntl(<CardEditor card={value} />);
}

function type(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

const validationFailed = (fields: { field: string; code: string }[]) =>
  new ApiError({ status: 400, code: "validation_failed", message: "Invalid fields.", requestId: "r1", fields });

beforeEach(() => {
  get.mockReset().mockResolvedValue({ data: { status: "current", slug: null } });
  put.mockReset();
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
    expect(within(form).queryByTestId("phone-preview")).toBeNull();
    // The columns are side by side from the large breakpoint, stacked below it.
    expect(screen.getByTestId("card-editor").className).toContain("lg:grid-cols-2");
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
    fireEvent.click(screen.getByTestId("link-add"));
    type("link-url-1", "https://b.example.test");
    // TPL-027: icons by default, a website is an icon named after its kind and its address.
    expect(preview.getByTestId("card-link-1").textContent).toBe("");
    expect(preview.getByTestId("card-link-1")).toHaveAttribute("aria-label", "Site web — b.example.test");

    // TPL-004: a setting of the template changes the preview.
    await chooseOption(screen.getByLabelText("Disposition des liens"), "Liste");
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

    await waitFor(() => expect(screen.getByTestId("editor-status")).toHaveTextContent("Modifications enregistrées"));
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

  test("TPL-013 TPL-018 a low contrast warns and does not block saving", () => {
    renderEditor();
    expect(screen.queryByTestId("contrast-warning")).toBeNull();
    fireEvent.change(screen.getByTestId("theme-text"), { target: { value: "#ffffff" } });
    expect(screen.getByTestId("contrast-warning")).toBeVisible();
    expect(screen.getByTestId("editor-save")).toBeEnabled();
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

  test("EDI-016 the back link asks for confirmation only when there are unsaved changes", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditor();
    expect(backNavigates()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();

    type("editor-job_title", "Directrice");
    expect(backNavigates()).toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("modifications non enregistrées"));

    confirm.mockReturnValue(true);
    expect(backNavigates()).toBe(true);
  });

  test("EDI-016 a link outside the editor, such as the page header, asks too", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditor();
    const header = document.body.appendChild(document.createElement("a"));
    header.href = "/account";
    header.dataset.testid = "outside-link";
    type("editor-job_title", "Directrice");
    expect(backNavigates("outside-link")).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    header.remove();
  });

  test("EDI-018 the events of the card are one link away, which also asks before leaving unsaved changes", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditor();
    expect(screen.getByTestId("editor-events")).toHaveAttribute(
      "href",
      "/dashboard/cards/0198c8a0-0000-7000-8000-000000000001/events",
    );
    expect(screen.getByTestId("editor-events")).toHaveTextContent("Événements");
    expect(backNavigates("editor-events")).toBe(true);

    type("editor-job_title", "Directrice");
    expect(backNavigates("editor-events")).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  test("EDI-016 reverting a setting leaves the editor clean", async () => {
    renderEditor();
    const layout = screen.getByLabelText("Disposition des liens");
    await chooseOption(layout, "Liste");
    expect(screen.getByTestId("editor-status")).toHaveTextContent("Modifications non enregistrées");
    await chooseOption(layout, "Icônes");
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
    await waitFor(() => expect(screen.getByTestId("editor-status")).toHaveTextContent("Modifications enregistrées"));
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
