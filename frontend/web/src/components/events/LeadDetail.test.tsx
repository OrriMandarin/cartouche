import { ApiError } from "@cartouche/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithIntl } from "@/components/editor/test-helpers";
import type { LeadActions } from "@/lib/events/lead-actions";
import { leadView } from "@/lib/events/lead-view.fixture";
import type { AnswerSnapshot, LeadView } from "@/lib/events/types";
const showToast = vi.fn();
vi.mock("@/lib/toast", () => ({ showToast: (...args: unknown[]) => showToast(...args) }));

import { LeadDetail } from "./LeadDetail";

const setSpam = vi.fn();
const remove = vi.fn();
const actions: LeadActions = { setSpam, remove };
const onChange = vi.fn();
const onClose = vi.fn();

const answer = (
  fieldId: string,
  label: string,
  kind: AnswerSnapshot["kind"],
  value: unknown,
): AnswerSnapshot => ({ field_id: fieldId, label, kind, value });

const wedding = leadView({
  event_title: "Salon du Mariage Clermont 2027",
  submitted_at: "2027-03-15T08:30:00Z",
  consent_at: "2027-03-15T08:29:00Z",
  consent_text: "Vos coordonnées restent chez l’Atelier Durand & Fils.",
  answers: {
    first_name: "Éloïse",
    last_name: "D’Aubigné-Müller",
    email: "eloise@example.test",
    phone: "+33612345678",
    birth_date: "1990-04-02",
    street: "12 rue des Lilas",
    postal_code: "63000",
    city: "Clermont-Ferrand",
    country: "France",
  },
  custom: [
    answer("f-date", "Date du mariage", "date", "2027-09-18"),
    answer("f-guests", "Nombre d'invités", "number", 120),
    answer("f-plan", "Formule", "single_choice", "Prestige"),
    answer("f-brochure", "Recevoir la brochure", "checkbox", true),
    answer("f-refused", "Régime alimentaire", "checkbox", false),
    answer("f-deleted", "Entreprise", "text", "Hébert & Fils"),
    answer("f-empty", "Remarque", "long_text", null),
  ],
});

function show(lead: LeadView = wedding, withActions: LeadActions | null = actions) {
  return renderWithIntl(<LeadDetail lead={lead} zone="Europe/Paris" actions={withActions} onChange={onChange} onClose={onClose} />);
}

beforeEach(() => {
  setSpam.mockReset();
  remove.mockReset();
  onChange.mockReset();
  onClose.mockReset();
  showToast.mockReset();
  setSpam.mockImplementation((lead: LeadView, spam: boolean) => Promise.resolve({ ...lead, spam }));
  remove.mockResolvedValue(undefined);
});

describe("LeadDetail", () => {
  test("LEA-003 LEA-018 the detail shows the event, the date and every answered standard field", () => {
    show();
    const detail = screen.getByTestId("lead-detail");
    expect(detail).toHaveTextContent("Éloïse D’Aubigné-Müller");
    expect(screen.getByTestId("lead-detail-event")).toHaveTextContent("Salon du Mariage Clermont 2027");
    // Stored in UTC, shown in the user's zone (EVT-022).
    expect(screen.getByTestId("lead-detail-submitted")).toHaveTextContent("Lun. 15 mars 2027 à 09:30");
    expect(screen.getByTestId("lead-detail-field-first_name")).toHaveTextContent("PrénomÉloïse");
    expect(screen.getByTestId("lead-detail-field-last_name")).toHaveTextContent("NomD’Aubigné-Müller");
    expect(screen.getByTestId("lead-detail-field-email")).toHaveTextContent("eloise@example.test");
    expect(screen.getByTestId("lead-detail-field-phone")).toHaveTextContent("+33 6 12 34 56 78");
    expect(screen.getByTestId("lead-detail-address")).toHaveTextContent("12 rue des Lilas");
    expect(screen.getByTestId("lead-detail-address")).toHaveTextContent("63000");
    expect(screen.getByTestId("lead-detail-address")).toHaveTextContent("Clermont-Ferrand");
    expect(screen.getByTestId("lead-detail-address")).toHaveTextContent("France");
  });

  test("LEA-018 a standard field the contact did not answer is not shown", () => {
    show(leadView({ answers: { email: "anna@example.test" }, phone_display: null }));
    expect(screen.getByTestId("lead-detail-field-email")).toBeVisible();
    expect(screen.queryByTestId("lead-detail-field-first_name")).toBeNull();
    expect(screen.queryByTestId("lead-detail-field-phone")).toBeNull();
    expect(screen.queryByTestId("lead-detail-address")).toBeNull();
  });

  test("LEA-003 LEA-018 the detail shows every answer, deleted fields and the consent text", () => {
    show();
    expect(screen.getByTestId("lead-detail-answer-f-plan")).toHaveTextContent("FormulePrestige");
    expect(screen.getByTestId("lead-detail-answer-f-guests")).toHaveTextContent("Nombre d'invités120");
    // A field deleted since is shown with the label it had (FRM-023).
    expect(screen.getByTestId("lead-detail-answer-f-deleted")).toHaveTextContent("EntrepriseHébert & Fils");
    expect(screen.getByTestId("lead-detail-consent")).toHaveTextContent("Accepté le 15 mars 2027 à 09:29");
    expect(screen.getByTestId("lead-detail-consent")).toHaveTextContent("Vos coordonnées restent chez l’Atelier Durand & Fils.");
    expect(screen.getByTestId("lead-detail-consent")).toHaveTextContent("Consentement");
  });

  test("LEA-019 the detail reads Oui, Non, Non renseigné and French dates", () => {
    show();
    expect(screen.getByTestId("lead-detail-answer-f-brochure")).toHaveTextContent("Recevoir la brochureOui");
    expect(screen.getByTestId("lead-detail-answer-f-refused")).toHaveTextContent("Régime alimentaireNon");
    expect(screen.getByTestId("lead-detail-answer-f-date")).toHaveTextContent("Date du mariage18/09/2027");
    expect(screen.getByTestId("lead-detail-answer-f-empty")).toHaveTextContent("RemarqueNon renseigné");
    expect(screen.getByTestId("lead-detail-field-birth_date")).toHaveTextContent("Date de naissance02/04/1990");
  });

  test("LEA-018 the detail carries the Spam label only when the contact is marked as spam", () => {
    const { unmount } = show();
    expect(screen.queryByTestId("lead-detail-spam-state")).toBeNull();
    expect(screen.getByTestId("lead-detail-spam")).toHaveTextContent("Marquer comme spam");
    unmount();
    show(leadView({ spam: true }));
    expect(screen.getByTestId("lead-detail-spam-state")).toHaveTextContent("Spam");
    expect(screen.getByTestId("lead-detail-spam")).toHaveTextContent("Retirer le marquage spam");
  });

  test("LEA-003 the email and the phone number can be used from the detail", () => {
    show();
    expect(screen.getByRole("link", { name: "eloise@example.test" })).toHaveAttribute("href", "mailto:eloise@example.test");
    expect(screen.getByRole("link", { name: "+33 6 12 34 56 78" })).toHaveAttribute("href", "tel:+33612345678");
  });

  test("LEA-003 the consent says it was accepted, when, and quotes the text as recorded", () => {
    show();
    const consent = screen.getByTestId("lead-detail-consent");
    expect(consent).toHaveTextContent("Accepté le 15 mars 2027 à 09:29");
    // French typography: non-breaking spaces inside the quotation marks.
    expect(consent.textContent).toContain("«\u00a0Vos coordonnées restent chez l’Atelier Durand & Fils.\u00a0»");
  });

  test("LEA-003 a contact without custom answers has no « Réponses » section", () => {
    show(leadView({ custom: [] }));
    expect(screen.queryByRole("heading", { name: "Réponses" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Coordonnées" })).toBeVisible();
  });

  test("LEA-004 LEA-020 LEA-034 a spam toggle reports the contact the server answers, announces it and closes the sheet", async () => {
    show();
    fireEvent.click(screen.getByTestId("lead-detail-spam"));
    await waitFor(() => expect(setSpam).toHaveBeenCalledWith(wedding, true));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ kind: "updated", lead: { ...wedding, spam: true } }));
    // The modal sheet closes, so that the « Annuler » toast (LEA-034) can be reached.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  test("LEA-004 LEA-020 deleting from the detail asks, then reports it and closes the detail", async () => {
    show();
    fireEvent.click(screen.getByTestId("lead-detail-delete"));
    expect(await screen.findByTestId("lead-delete-confirm")).toBeVisible();
    expect(screen.getByText("Ce contact sera supprimé définitivement.")).toBeVisible();
    expect(remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("lead-delete-cancel"));
    expect(remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("lead-detail-delete"));
    fireEvent.click(await screen.findByTestId("lead-delete-confirm"));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(wedding));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ kind: "removed", id: wedding.id }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("LEA-020 a failed deletion keeps the detail open and shows the generic notice", async () => {
    remove.mockRejectedValue(new ApiError({ status: 500, code: "internal_error", message: "Boom.", requestId: "req-del" }));
    show();
    fireEvent.click(screen.getByTestId("lead-detail-delete"));
    fireEvent.click(await screen.findByTestId("lead-delete-confirm"));
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-del");
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("lead-detail-delete")).toBeEnabled();
  });

  test("ADM-017 without actions there is no spam or delete button", () => {
    show(wedding, null);
    expect(within(screen.getByTestId("lead-detail")).queryByTestId("lead-detail-spam")).toBeNull();
    expect(screen.queryByTestId("lead-detail-delete")).toBeNull();
    expect(screen.getByTestId("lead-detail-name")).toBeVisible();
  });
});
