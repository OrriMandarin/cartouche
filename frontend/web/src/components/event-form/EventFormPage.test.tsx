import { ApiError } from "@cartouche/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithIntl } from "@/components/editor/test-helpers";
import { emptyLeadDraft } from "@/lib/event-form/answers";
import { publicEventForm } from "@/lib/event-form/form.fixture";
import { saveDraft } from "@/lib/event-form/persist";
import type { PublicEventForm } from "@/lib/event-form/types";
import { sampleCard } from "@/templates/fixtures";

const unlockEvent = vi.fn();
const submitLead = vi.fn();
const reloadForm = vi.fn();
vi.mock("@/lib/event-form/requests", () => ({
  unlockEvent: (...args: unknown[]) => unlockEvent(...args),
  submitLead: (...args: unknown[]) => submitLead(...args),
  reloadForm: (...args: unknown[]) => reloadForm(...args),
}));

import { EventFormPage, type FillableEvent } from "./EventFormPage";

const SLUG = sampleCard.slug;
// Only the first name and the email: the tests fill them in a few lines.
const form = publicEventForm({
  standard_fields: [
    { field: "first_name", required: true },
    { field: "email", required: true },
  ],
  custom_fields: [],
});
const EVENT_ID = form.id;
const open: FillableEvent = { state: "open", event: form };
const coded: FillableEvent = { state: "code_required", event: { id: EVENT_ID, title: form.title } };

function refusal(status: number, code: string, fields: { field: string; code: string }[] = []) {
  return new ApiError({ status, code, message: code, requestId: "req-1", fields });
}

function renderPage(initial: FillableEvent = open) {
  return renderWithIntl(<EventFormPage slug={SLUG} card={sampleCard} initial={initial} />);
}

const field = (path: string) => screen.getByTestId(`field-${path}`);

function fill(firstName = "Éloïse", email = "eloise@example.test") {
  fireEvent.change(field("answers.first_name"), { target: { value: firstName } });
  fireEvent.change(field("answers.email"), { target: { value: email } });
}

function consent() {
  fireEvent.click(screen.getByTestId("consent-checkbox"));
}

function send() {
  fireEvent.click(screen.getByTestId("event-form-submit"));
}

async function unlockWith(code: string, unlocked: PublicEventForm = form) {
  unlockEvent.mockResolvedValueOnce(unlocked);
  fireEvent.change(screen.getByTestId("access-code-input"), { target: { value: code } });
  fireEvent.click(screen.getByTestId("access-code-submit"));
  await screen.findByTestId("event-form");
}

beforeEach(() => {
  unlockEvent.mockReset();
  submitLead.mockReset();
  reloadForm.mockReset();
  submitLead.mockResolvedValue(undefined);
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe("EventFormPage", () => {
  test("FRM-001 the way back goes to the card", () => {
    renderPage();
    expect(screen.getByTestId("event-form-back")).toHaveAttribute("href", `/c/${SLUG}`);
    expect(screen.getByTestId("event-form-back")).toHaveTextContent("Retour à la carte");
  });

  test("FRM-002 the code screen comes first", async () => {
    renderPage(coded);
    expect(screen.getByTestId("event-form-title")).toHaveTextContent(form.title);
    expect(screen.queryByTestId("event-form")).toBeNull();
    expect(screen.queryByTestId("consent-text")).toBeNull();

    unlockEvent.mockRejectedValueOnce(refusal(403, "invalid_access_code"));
    fireEvent.change(screen.getByTestId("access-code-input"), { target: { value: "moulin" } });
    fireEvent.click(screen.getByTestId("access-code-submit"));
    expect(await screen.findByTestId("access-code-message")).toHaveTextContent("Ce code n'est pas le bon.");
    expect(unlockEvent).toHaveBeenCalledWith(SLUG, EVENT_ID, "moulin");

    await unlockWith(" chateau ");
    expect(unlockEvent).toHaveBeenLastCalledWith(SLUG, EVENT_ID, " chateau ");
    expect(screen.getByTestId("consent-text")).toHaveTextContent(form.consent_text);
    fill();
    consent();
    send();
    await screen.findByTestId("event-form-confirmation");
    expect(submitLead.mock.calls[0]?.[2]).toMatchObject({ access_code: " chateau ", form_version: form.form_version });
  });

  test("FRM-016 EVT-028 the answers go out with the device, the form version and the trap", async () => {
    renderPage();
    fill(" Éloïse ");
    consent();
    send();
    await screen.findByTestId("event-form-confirmation");
    const [slug, eventId, body] = submitLead.mock.calls[0] ?? [];
    expect([slug, eventId]).toEqual([SLUG, EVENT_ID]);
    expect(body).toMatchObject({
      form_version: form.form_version,
      consent: true,
      fax: "",
      answers: { first_name: "Éloïse", email: "eloise@example.test" },
    });
    expect(body.device_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).not.toHaveProperty("access_code");
  });

  test("FRM-015 errors sit next to each field and the input stays", async () => {
    renderPage();
    fill("Éloïse", "eloise@");
    send();
    expect(await screen.findByTestId("field-error-answers.email")).toHaveTextContent(
      "Cette adresse e-mail n'est pas valide.",
    );
    expect(screen.getByTestId("field-error-consent")).toBeInTheDocument();
    expect(field("answers.first_name")).toHaveValue("Éloïse");
    expect(field("answers.email")).toHaveValue("eloise@");
    expect(submitLead).not.toHaveBeenCalled();

    // The server's own field errors land in the same place.
    submitLead.mockRejectedValueOnce(refusal(400, "validation_failed", [{ field: "answers.email", code: "invalid_email" }]));
    fireEvent.change(field("answers.email"), { target: { value: "eloise@exemple.invalid" } });
    consent();
    send();
    await waitFor(() => expect(submitLead).toHaveBeenCalled());
    expect(await screen.findByTestId("field-error-answers.email")).toHaveTextContent("Cette adresse e-mail n'est pas valide.");
    expect(field("answers.email")).toHaveValue("eloise@exemple.invalid");
    expect(screen.queryByTestId("field-error-consent")).toBeNull();
  });

  test("FRM-041 a changed code goes back to the code screen, answers kept", async () => {
    renderPage(coded);
    await unlockWith("chateau");
    fill("Zoé");
    consent();
    submitLead.mockRejectedValueOnce(refusal(403, "invalid_access_code"));
    send();
    expect(await screen.findByTestId("access-code-message")).toHaveTextContent("Le code d'accès a changé.");
    expect(screen.getByTestId("access-code-input")).toHaveValue("");

    await unlockWith("moulin");
    expect(field("answers.first_name")).toHaveValue("Zoé");
    expect(screen.getByTestId("consent-checkbox")).toBeChecked();
    send();
    await screen.findByTestId("event-form-confirmation");
    expect(submitLead.mock.calls[1]?.[2]).toMatchObject({ access_code: "moulin", answers: { first_name: "Zoé" } });
  });

  test("FRM-030 a changed form is loaded again, the answers kept and the consent unchecked", async () => {
    renderPage();
    fill("Zoé");
    consent();
    const changed = publicEventForm({ ...form, title: "Salon d’été ✨", form_version: "ffffffffffffffff" });
    submitLead.mockRejectedValueOnce(refusal(409, "form_changed"));
    reloadForm.mockResolvedValueOnce({ kind: "form", form: changed });
    send();
    expect(await screen.findByTestId("event-form-message")).toHaveTextContent("Le formulaire a été modifié");
    expect(reloadForm).toHaveBeenCalledWith(SLUG, EVENT_ID, null);
    expect(screen.getByTestId("event-form-title")).toHaveTextContent("Salon d’été ✨");
    expect(field("answers.first_name")).toHaveValue("Zoé");
    expect(screen.getByTestId("consent-checkbox")).not.toBeChecked();
    consent();
    send();
    await screen.findByTestId("event-form-confirmation");
    expect(submitLead.mock.calls[1]?.[2]).toMatchObject({ form_version: "ffffffffffffffff" });
  });

  test("FRM-004 the confirmation offers the vCard and the way back", async () => {
    renderPage();
    fill();
    consent();
    send();
    const confirmation = await screen.findByTestId("event-form-confirmation");
    expect(confirmation).toHaveTextContent("Vos informations ont bien été envoyées.");
    const save = screen.getByTestId("confirmation-save-contact");
    expect(save).toHaveAttribute("href", sampleCard.vcard_url);
    expect(save).toHaveAttribute("download");
    expect(save).toHaveTextContent("Enregistrer le contact");
    expect(screen.getByTestId("confirmation-back")).toHaveAttribute("href", `/c/${SLUG}`);
    expect(screen.queryByTestId("event-form")).toBeNull();
    // The answers are forgotten once sent (FRM-040).
    expect(window.sessionStorage.getItem(`cartouche.lead.${EVENT_ID}`)).toBeNull();
  });

  test("FRM-042 FRM-040 each refusal and a network error have their message", async () => {
    const cases: [unknown, string][] = [
      [refusal(409, "event_closed"), "Ce formulaire est fermé"],
      [refusal(409, "device_limit_reached"), "Vous avez déjà envoyé ce formulaire depuis cet appareil."],
      [refusal(429, "rate_limited"), "Trop d'envois depuis ce réseau."],
      [refusal(410, "card_inactive"), "Cette carte n'est plus active"],
      [refusal(500, "internal_error"), "Une erreur est survenue."],
    ];
    renderPage();
    fill();
    consent();
    for (const [error, text] of cases) {
      submitLead.mockRejectedValueOnce(error);
      send();
      await waitFor(() => expect(screen.getByTestId("event-form-message")).toHaveTextContent(text));
      expect(screen.queryByTestId("event-form-retry")).toBeNull();
      expect(field("answers.first_name")).toHaveValue("Éloïse");
    }

    submitLead.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    send();
    expect(await screen.findByTestId("event-form-message")).toHaveTextContent("La connexion a échoué.");
    fireEvent.click(screen.getByTestId("event-form-retry"));
    await screen.findByTestId("event-form-confirmation");
    expect(submitLead).toHaveBeenCalledTimes(cases.length + 2);
  });

  test("FRM-040 every keystroke is kept, and a reload brings the answers back with the consent unchecked", async () => {
    const first = renderPage();
    fill("Zoé", "zoe@example.test");
    consent();
    first.unmount();

    renderPage();
    await waitFor(() => expect(field("answers.first_name")).toHaveValue("Zoé"));
    expect(field("answers.email")).toHaveValue("zoe@example.test");
    expect(screen.getByTestId("consent-checkbox")).not.toBeChecked();
  });

  test("FRM-040 FRM-030 a kept draft that no longer fits the form keeps what still applies", async () => {
    const draft = { ...emptyLeadDraft(publicEventForm()), consent: true };
    draft.answers.first_name = "Zoé";
    draft.answers.last_name = "Lefèvre ✨";
    saveDraft(EVENT_ID, draft);
    renderPage(coded);
    await unlockWith("chateau");
    expect(field("answers.first_name")).toHaveValue("Zoé");
    expect(screen.queryByTestId("field-answers.last_name")).toBeNull();
    expect(screen.getByTestId("consent-checkbox")).not.toBeChecked();
  });
});
