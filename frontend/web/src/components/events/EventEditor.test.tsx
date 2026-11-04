import { ApiError } from "@cartouche/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cardView } from "@/components/cards/card-view.fixture";
import { chooseOption, renderWithIntl } from "@/components/editor/test-helpers";
import { eventView } from "@/lib/events/event-view.fixture";
import type { EventView } from "@/lib/events/types";

const post = vi.fn();
const put = vi.fn();
const push = vi.fn();
const api = { POST: post, PUT: put };
vi.mock("@/lib/api", () => ({ useApi: () => api }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/events/time", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/time")>()),
  userTimeZone: () => "Europe/Paris",
}));

import { EventEditor } from "./EventEditor";

const CARD_ID = "card-1";
const withEmail = cardView({ id: CARD_ID, content: { first_name: "Alice", last_name: "Durand", email: "alice@example.test" } });
const withoutEmail = cardView({ id: CARD_ID, content: { first_name: "Alice", last_name: "Durand" } });

function renderEditor(event?: EventView, card = withEmail) {
  // The page header (« Mon compte ») is rendered by the page around the editor, not by the editor.
  renderWithIntl(
    <>
      <a href="/account" data-testid="account-link">
        Mon compte
      </a>
      <EventEditor cardId={CARD_ID} card={card} {...(event ? { event } : {})} />
    </>,
  );
}

function type(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

/**
 * Body of the last save request. The consent preview, asked 300 ms after the last keystroke of the title, may
 * land at any moment: it is not a save and must not shadow it.
 */
function lastBody(mock: typeof post) {
  const call = mock.mock.calls.findLast(([path]) => path !== "/api/cards/{id}/consent-preview");
  if (!call) throw new Error("no call");
  return (call[1] as { body: Record<string, unknown> }).body;
}

function rejectWith(status: number, code: string, fields: { field: string; code: string }[] = []) {
  return new ApiError({ status, code, message: "no", requestId: "req-1", fields });
}

beforeEach(() => {
  post.mockReset();
  put.mockReset();
  push.mockReset();
  post.mockImplementation((path: string, { body }: { body: { title: string } }) =>
    Promise.resolve({
      data: path === "/api/cards/{id}/consent-preview" ? { text: `Texte par défaut pour « ${body.title} ».` } : eventView(),
    }),
  );
  put.mockResolvedValue({ data: eventView() });
});

afterEach(() => vi.restoreAllMocks());

/** Clicks the link and tells whether the guard let the navigation go; the navigation itself is stopped. */
function linkNavigates(testId: string): boolean {
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

function closesTheTab(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return !event.defaultPrevented;
}

describe("EventEditor", () => {
  test("EVT-022 the time zone is shown next to the dates", () => {
    renderEditor();
    expect(screen.getByTestId("event-zone")).toHaveTextContent("Europe/Paris");
  });

  test("EVT-014 EVT-030 the device limit starts at 1 and is a number from 1 to 100", () => {
    renderEditor();
    const input = screen.getByTestId("event-device-limit");
    expect(input).toHaveAttribute("type", "number");
    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("max", "100");
    expect(input).toHaveValue(1);
  });

  test("FRM-017 FRM-019 standard fields: not asked, optional or required", async () => {
    renderEditor();
    expect(screen.getByTestId("standard-field-first_name")).toHaveTextContent("Obligatoire");
    expect(screen.getByTestId("standard-field-phone")).toHaveTextContent("Facultatif");
    expect(screen.getByTestId("standard-field-birth_date")).toHaveTextContent("Non demandé");
    expect(screen.getByTestId("standard-field-address")).toHaveTextContent("Non demandé");

    await chooseOption(screen.getByTestId("standard-field-address"), "Facultatif");
    await chooseOption(screen.getByTestId("standard-field-phone"), "Non demandé");
    type("event-title", "Salon");
    fireEvent.click(screen.getByTestId("event-save"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/cards/{id}/events", expect.anything()));
    expect(lastBody(post)).toMatchObject({
      standard_fields: { first_name: "required", phone: "off", address: "optional", birth_date: "off", email: "required" },
    });
  });

  test("FRM-020 FRM-021 custom fields: add by type, options, reorder, remove", async () => {
    renderEditor();
    fireEvent.click(screen.getByTestId("custom-add-text"));
    fireEvent.click(screen.getByTestId("custom-add-single_choice"));
    fireEvent.click(screen.getByTestId("custom-add-checkbox"));
    expect(screen.getAllByTestId(/^custom-field-\d+$/)).toHaveLength(3);
    // A single choice field starts with two options; the other kinds have none.
    expect(screen.getByTestId("custom-option-1-0")).toBeVisible();
    expect(screen.getByTestId("custom-option-1-1")).toBeVisible();
    expect(screen.queryByTestId("custom-option-0-0")).toBeNull();
    expect(screen.queryByTestId("custom-option-2-0")).toBeNull();

    type("custom-label-0", "Zoé Lefèvre ✨");
    type("custom-label-1", "Votre budget");
    type("custom-help-1", "Pour le devis");
    fireEvent.click(screen.getByTestId("custom-required-1"));
    type("custom-option-1-0", "< 5 000 €");
    type("custom-option-1-1", "> 5 000 €");
    fireEvent.click(screen.getByTestId("custom-option-add-1"));
    type("custom-option-1-2", "Je ne sais pas");
    fireEvent.click(screen.getByTestId("custom-option-remove-1-2"));
    type("custom-label-2", "Newsletter");

    fireEvent.click(screen.getByTestId("custom-up-1"));
    expect(screen.getByTestId("custom-label-0")).toHaveValue("Votre budget");
    expect(screen.getByTestId("custom-label-1")).toHaveValue("Zoé Lefèvre ✨");
    fireEvent.click(screen.getByTestId("custom-remove-2"));
    expect(screen.queryByTestId("custom-field-2")).toBeNull();

    type("event-title", "Salon");
    fireEvent.click(screen.getByTestId("event-save"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/cards/{id}/events", expect.anything()));
    const fields = lastBody(post)["custom_fields"] as { label: string; kind: string; required: boolean; help: string | null; options: string[] }[];
    expect(fields.map(({ label, kind, required, help, options }) => ({ label, kind, required, help, options }))).toEqual([
      { label: "Votre budget", kind: "single_choice", required: true, help: "Pour le devis", options: ["< 5 000 €", "> 5 000 €"] },
      { label: "Zoé Lefèvre ✨", kind: "text", required: false, help: null, options: [] },
    ]);
  });

  test("FRM-029 R-PF6 the default consent text comes from the server and follows the title", async () => {
    renderEditor();
    type("event-title", "Salon");
    await waitFor(() => expect(screen.getByTestId("consent-default-text")).toHaveTextContent("Texte par défaut pour « Salon »."));
    expect(post).toHaveBeenCalledWith("/api/cards/{id}/consent-preview", {
      params: { path: { id: CARD_ID } },
      body: { title: "Salon" },
    });
    type("event-title", "Salon d’été ✨");
    await waitFor(() =>
      expect(screen.getByTestId("consent-default-text")).toHaveTextContent("Texte par défaut pour « Salon d’été ✨ »."),
    );
    expect(screen.queryByTestId("consent-no-email")).toBeNull();
  });

  test("FRM-029 a card without an email gets a warning next to the default text", async () => {
    renderEditor(undefined, withoutEmail);
    expect(screen.getByTestId("consent-no-email")).toHaveTextContent("n'a pas d'e-mail");
  });

  test("FRM-028 FRM-029 a custom consent text replaces the default one, and goes with the save", async () => {
    renderEditor();
    type("event-title", "Salon");
    await chooseOption(screen.getByTestId("consent-mode"), "Texte personnalisé");
    expect(screen.queryByTestId("consent-default-text")).toBeNull();
    expect(screen.queryByTestId("consent-no-email")).toBeNull();
    type("consent-text", "Vos coordonnées restent chez moi.");
    fireEvent.click(screen.getByTestId("event-save"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/cards/{id}/events", expect.anything()));
    expect(lastBody(post)["consent_text"]).toBe("Vos coordonnées restent chez moi.");
  });

  test("EVT-007 EVT-017 the dates are sent as UTC, and « Sans fin » drops the end", async () => {
    renderEditor();
    type("event-title", "Salon");
    type("event-starts-at", "2027-04-02T10:00");
    expect(screen.getByTestId("event-no-end")).toBeChecked();
    fireEvent.click(screen.getByTestId("event-no-end"));
    expect(screen.getByTestId("event-no-end")).not.toBeChecked();
    expect(screen.getByTestId("event-ends-at")).toHaveValue("2027-04-02T11:00");
    type("event-ends-at", "2027-04-02T18:00");
    fireEvent.click(screen.getByTestId("event-save"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/cards/{id}/events", expect.anything()));
    expect(lastBody(post)).toMatchObject({ starts_at: "2027-04-02T08:00:00.000Z", ends_at: "2027-04-02T16:00:00.000Z" });

    fireEvent.click(screen.getByTestId("event-no-end"));
    expect(screen.getByTestId("event-ends-at")).toHaveValue("");
  });

  test("EVT-001 EDI-019 a created event goes back to the list of the card", async () => {
    renderEditor();
    type("event-title", "Salon de l’Artisanat ✨");
    type("event-description", "Rencontrez Éloïse D’Aubigné-Müller.");
    type("event-access-code", "Château");
    type("event-device-limit", "3");
    fireEvent.click(screen.getByTestId("event-save"));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/dashboard/cards/${CARD_ID}/events`));
    expect(post).toHaveBeenCalledWith("/api/cards/{id}/events", {
      params: { path: { id: CARD_ID } },
      body: expect.objectContaining({
        title: "Salon de l’Artisanat ✨",
        description: "Rencontrez Éloïse D’Aubigné-Müller.",
        access_code: "Château",
        device_limit: 3,
        consent_text: null,
      }),
    });
    expect(put).not.toHaveBeenCalled();
  });

  test("EVT-009 EVT-010 EDI-019 an existing event opens filled in, the access code in clear, and is saved with PUT", async () => {
    const event = eventView({
      id: "event-9",
      title: "Portes ouvertes",
      description: "Venez nombreux",
      starts_at: "2027-04-02T08:00:00Z",
      ends_at: "2027-04-02T16:30:00Z",
      access_code: "Château",
      device_limit: 2,
      default_consent_text: "Texte par défaut du serveur.",
    });
    renderEditor(event);
    expect(screen.getByTestId("event-title")).toHaveValue("Portes ouvertes");
    expect(screen.getByTestId("event-description")).toHaveValue("Venez nombreux");
    expect(screen.getByTestId("event-starts-at")).toHaveValue("2027-04-02T10:00");
    expect(screen.getByTestId("event-ends-at")).toHaveValue("2027-04-02T18:30");
    expect(screen.getByTestId("event-access-code")).toHaveValue("Château");
    expect(screen.getByTestId("event-access-code")).toHaveAttribute("type", "text");
    expect(screen.getByTestId("event-device-limit")).toHaveValue(2);
    // The text the server already gave is shown at once, and not asked again while the title is the same.
    expect(screen.getByTestId("consent-default-text")).toHaveTextContent("Texte par défaut du serveur.");

    type("event-title", "Portes ouvertes ✨");
    fireEvent.click(screen.getByTestId("event-save"));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/api/events/{id}", {
        params: { path: { id: "event-9" } },
        body: expect.objectContaining({ title: "Portes ouvertes ✨", access_code: "Château", device_limit: 2 }),
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/dashboard/cards/${CARD_ID}/events`));
    expect(post).not.toHaveBeenCalledWith("/api/cards/{id}/events", expect.anything());
  });

  test("EDI-019 EDI-015 a rejected save keeps the input and shows each error under its field", async () => {
    put.mockRejectedValue(
      rejectWith(400, "validation_failed", [
        { field: "title", code: "required" },
        { field: "ends_at", code: "end_before_start" },
        { field: "device_limit", code: "out_of_range" },
        { field: "access_code", code: "too_long" },
        { field: "standard_fields", code: "no_fields" },
        { field: "custom_fields[0].label", code: "required" },
        { field: "custom_fields[0].options[1]", code: "duplicate_option" },
        { field: "custom_fields[1].options", code: "too_few_options" },
        { field: "consent_text", code: "too_long" },
      ]),
    );
    renderEditor(eventView({ id: "event-9", title: "Salon", ends_at: "2027-03-16T10:00:00Z" }));
    fireEvent.click(screen.getByTestId("custom-add-single_choice"));
    fireEvent.click(screen.getByTestId("custom-add-single_choice"));
    type("custom-option-0-0", "Poterie");
    type("custom-option-0-1", "Poterie");
    type("event-device-limit", "500");
    type("event-access-code", "x".repeat(40));
    await chooseOption(screen.getByTestId("consent-mode"), "Texte personnalisé");
    type("consent-text", "Mon texte ✨");
    fireEvent.click(screen.getByTestId("event-save"));

    expect(await screen.findByTestId("field-error-title")).toHaveTextContent("Ce champ est obligatoire.");
    expect(screen.getByTestId("field-error-ends-at")).toHaveTextContent("La fin doit être après le début.");
    expect(screen.getByTestId("field-error-device-limit")).toHaveTextContent("en dehors des limites");
    expect(screen.getByTestId("field-error-access-code")).toHaveTextContent("Ce texte est trop long.");
    expect(screen.getByTestId("field-error-standard-fields")).toHaveTextContent("au moins un champ");
    expect(screen.getByTestId("field-error-custom-fields-0-label")).toHaveTextContent("Ce champ est obligatoire.");
    expect(screen.getByTestId("field-error-custom-fields-0-options-1")).toHaveTextContent("déjà dans la liste");
    expect(screen.getByTestId("field-error-custom-fields-1-options")).toHaveTextContent("au moins 2 options");
    expect(screen.getByTestId("field-error-consent-text")).toHaveTextContent("Ce texte est trop long.");
    expect(screen.getByTestId("event-error-summary")).toBeVisible();

    // Each input points to its message, and nothing typed is lost.
    expect(screen.getByTestId("event-title")).toHaveAttribute("aria-describedby", "field-error-title");
    expect(screen.getByTestId("event-device-limit")).toHaveAttribute("aria-describedby", "field-error-device-limit");
    expect(screen.getByTestId("custom-option-0-1")).toHaveAttribute("aria-describedby", "field-error-custom-fields-0-options-1");
    expect(screen.getByTestId("event-device-limit")).toHaveValue(500);
    expect(screen.getByTestId("event-access-code")).toHaveValue("x".repeat(40));
    expect(screen.getByTestId("custom-option-0-0")).toHaveValue("Poterie");
    expect(screen.getByTestId("consent-text")).toHaveValue("Mon texte ✨");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByTestId("event-save")).toBeEnabled();

    // Fixing a field takes its message away, and only its own.
    type("event-title", "Salon ✨");
    expect(screen.queryByTestId("field-error-title")).toBeNull();
    expect(screen.getByTestId("field-error-device-limit")).toBeVisible();
    type("custom-option-0-1", "Tissage");
    expect(screen.queryByTestId("field-error-custom-fields-0-options-1")).toBeNull();
    expect(screen.getByTestId("field-error-custom-fields-0-label")).toBeVisible();
  });

  test("EDI-015 a refusal with a code the editor cannot place still says so", async () => {
    post.mockImplementation((path: string) =>
      path === "/api/cards/{id}/consent-preview"
        ? Promise.resolve({ data: { text: "x" } })
        : Promise.reject(rejectWith(400, "validation_failed", [{ field: "custom_fields[0].kind", code: "invalid_value" }])),
    );
    renderEditor();
    type("event-title", "Salon");
    fireEvent.click(screen.getByTestId("event-save"));
    expect(await screen.findByTestId("event-error-summary")).toBeVisible();
    expect(screen.getByTestId("event-title")).toHaveValue("Salon");
  });

  test("EVT-018 too many simultaneous events is explained at the top, and the input is kept", async () => {
    post.mockImplementation((path: string) =>
      path === "/api/cards/{id}/consent-preview"
        ? Promise.resolve({ data: { text: "x" } })
        : Promise.reject(rejectWith(409, "too_many_simultaneous_events")),
    );
    renderEditor();
    type("event-title", "Salon ✨");
    fireEvent.click(screen.getByTestId("event-save"));
    expect(await screen.findByTestId("event-conflict")).toHaveTextContent("maximum d'événements en même temps");
    expect(screen.getByTestId("event-title")).toHaveValue("Salon ✨");
    expect(screen.queryByTestId("event-error-summary")).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByTestId("event-save")).toBeEnabled();
  });

  test("EDI-015 any other failure shows the generic notice with the request id", async () => {
    post.mockImplementation((path: string) =>
      path === "/api/cards/{id}/consent-preview"
        ? Promise.resolve({ data: { text: "x" } })
        : Promise.reject(rejectWith(500, "internal_error")),
    );
    renderEditor();
    type("event-title", "Salon");
    fireEvent.click(screen.getByTestId("event-save"));
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-1");
    expect(screen.getByTestId("event-title")).toHaveValue("Salon");
  });

  test("EVT-018 a second click while saving sends nothing more", async () => {
    let finish: (value: unknown) => void = () => undefined;
    post.mockImplementation((path: string) =>
      path === "/api/cards/{id}/consent-preview"
        ? Promise.resolve({ data: { text: "x" } })
        : new Promise((resolve) => (finish = resolve)),
    );
    renderEditor();
    type("event-title", "Salon");
    fireEvent.click(screen.getByTestId("event-save"));
    await waitFor(() => expect(screen.getByTestId("event-save")).toBeDisabled());
    fireEvent.click(screen.getByTestId("event-save"));
    expect(post.mock.calls.filter(([path]) => path === "/api/cards/{id}/events")).toHaveLength(1);
    finish({ data: eventView() });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });

  test("EDI-019 the back link returns to the list of the events", () => {
    renderEditor();
    expect(within(screen.getByTestId("event-editor")).getByTestId("event-back")).toHaveAttribute(
      "href",
      `/dashboard/cards/${CARD_ID}/events`,
    );
  });

  test("EDI-021 leaving the event editor with unsaved changes asks first", () => {
    renderEditor(eventView());
    expect(closesTheTab()).toBe(true);

    type("event-title", "Salon de l’Artisanat 2028 ✨");
    expect(closesTheTab()).toBe(false);
    expect(screen.getByTestId("event-status")).toHaveTextContent("Modifications non enregistrées");
  });

  test("EDI-021 every link of the page asks only when there are unsaved changes", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditor(eventView());
    expect(screen.getByTestId("event-back")).toHaveAttribute("href", `/dashboard/cards/${CARD_ID}/events`);
    expect(linkNavigates("event-back")).toBe(true);
    expect(linkNavigates("account-link")).toBe(true);
    expect(confirm).not.toHaveBeenCalled();

    type("event-title", "Salon de l’Artisanat 2028 ✨");
    expect(linkNavigates("event-back")).toBe(false);
    expect(linkNavigates("account-link")).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("modifications non enregistrées"));

    confirm.mockReturnValue(true);
    expect(linkNavigates("event-back")).toBe(true);
    expect(linkNavigates("account-link")).toBe(true);
  });

  test("EDI-021 undoing the changes leaves the editor clean", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const stored = eventView();
    renderEditor(stored);
    type("event-title", "Autre titre");
    type("event-title", stored.title);
    expect(screen.getByTestId("event-status")).toBeEmptyDOMElement();
    expect(closesTheTab()).toBe(true);
    expect(linkNavigates("event-back")).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  test("EDI-021 after a save nothing is asked", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditor(eventView());
    type("event-title", "Salon de l’Artisanat 2028 ✨");
    fireEvent.click(screen.getByTestId("event-save"));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/dashboard/cards/${CARD_ID}/events`));
    expect(closesTheTab()).toBe(true);
    expect(linkNavigates("account-link")).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  test("EDI-021 a refused save keeps the changes unsaved", async () => {
    put.mockRejectedValue(rejectWith(400, "validation_failed", [{ field: "title", code: "required" }]));
    renderEditor(eventView());
    type("event-title", "");
    fireEvent.click(screen.getByTestId("event-save"));
    await screen.findByTestId("event-error-summary");
    expect(closesTheTab()).toBe(false);
  });

  test("EDI-021 a date the browser accepts but no instant stands for does not crash the editor", () => {
    renderEditor(eventView());
    // A datetime-local input accepts a five-digit year after one extra keystroke.
    type("event-starts-at", "20277-03-15T10:00");
    expect(screen.getByTestId("event-status")).toHaveTextContent("Modifications non enregistrées");
    expect(closesTheTab()).toBe(false);
  });
});
