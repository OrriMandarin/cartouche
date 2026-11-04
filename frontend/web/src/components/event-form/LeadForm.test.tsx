import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { renderWithIntl } from "@/components/editor/test-helpers";
import { emptyLeadDraft } from "@/lib/event-form/answers";
import {
  CHECKBOX_ID,
  CHOICE_ID,
  DATE_ID,
  LONG_ID,
  NUMBER_ID,
  TEXT_ID,
  publicEventForm,
} from "@/lib/event-form/form.fixture";
import type { PublicEventForm } from "@/lib/event-form/types";
import { LeadForm, type LeadFormProps } from "./LeadForm";

function renderForm(overrides: Partial<LeadFormProps> = {}, form: PublicEventForm = publicEventForm()) {
  const props: LeadFormProps = {
    form,
    ownerName: "Éloïse D’Aubigné-Müller",
    draft: emptyLeadDraft(form),
    errors: {},
    attempt: 0,
    disabled: false,
    notice: null,
    onEdit: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  renderWithIntl(<LeadForm {...props} />);
  return props;
}

const field = (path: string) => screen.getByTestId(`field-${path}`);

describe("LeadForm", () => {
  test("FRM-003 FRM-017 FRM-018 title, description, standard then custom fields", () => {
    renderForm({}, publicEventForm({ description: "Venez nombreux ✨\nEntrée libre." }));
    expect(screen.getByTestId("event-form-title")).toHaveTextContent("Salon de l’Artisanat ✨");
    expect(screen.getByTestId("event-form-description")).toHaveTextContent("Venez nombreux ✨ Entrée libre.");
    const order = screen.getAllByTestId(/^field-answers\./).map((element) => element.dataset.testid);
    expect(order).toEqual([
      "field-answers.first_name",
      "field-answers.last_name",
      "field-answers.birth_date",
      "field-answers.email",
      "field-answers.phone",
      "field-answers.address.street",
      "field-answers.address.postal_code",
      "field-answers.address.city",
      "field-answers.address.country",
      `field-answers.custom.${TEXT_ID}`,
      `field-answers.custom.${LONG_ID}`,
      `field-answers.custom.${DATE_ID}`,
      `field-answers.custom.${NUMBER_ID}`,
      `field-answers.custom.${CHOICE_ID}`,
      `field-answers.custom.${CHECKBOX_ID}`,
    ]);
    // The country is proposed (FRM-033).
    expect(field("answers.address.country")).toHaveValue("France");
  });

  test("FRM-003 a form asks only for the fields its owner chose, in their order", () => {
    renderForm({}, publicEventForm({ standard_fields: [{ field: "email", required: true }], custom_fields: [] }));
    expect(screen.getAllByTestId(/^field-answers\./).map((element) => element.dataset.testid)).toEqual([
      "field-answers.email",
    ]);
    expect(screen.queryByTestId("event-form-description")).toBeNull();
  });

  test("FRM-005 FRM-039 every input has a label, a type and autocomplete", () => {
    renderForm();
    const expected: [string, string, string, string?][] = [
      ["answers.first_name", "text", "given-name"],
      ["answers.last_name", "text", "family-name"],
      ["answers.birth_date", "date", "bday"],
      ["answers.email", "email", "email"],
      ["answers.phone", "tel", "tel", "tel"],
      ["answers.address.street", "text", "street-address"],
      ["answers.address.postal_code", "text", "postal-code"],
      ["answers.address.city", "text", "address-level2"],
      ["answers.address.country", "text", "country-name"],
      [`answers.custom.${DATE_ID}`, "date", "off"],
      [`answers.custom.${NUMBER_ID}`, "text", "off", "decimal"],
    ];
    for (const [path, type, autoComplete, inputMode] of expected) {
      const input = field(path);
      expect(input, path).toHaveAttribute("type", type);
      expect(input, path).toHaveAttribute("autocomplete", autoComplete);
      if (inputMode) expect(input, path).toHaveAttribute("inputmode", inputMode);
    }
    expect(screen.getByLabelText(/^Prénom/)).toBe(field("answers.first_name"));
    expect(screen.getByLabelText(/^E-mail/)).toBe(field("answers.email"));
    expect(screen.getByLabelText(/^Ville/)).toBe(field("answers.address.city"));
    expect(screen.getByLabelText(/^Votre projet/)).toBe(field(`answers.custom.${LONG_ID}`));
    expect(screen.getByLabelText(/^Formule/)).toBe(field(`answers.custom.${CHOICE_ID}`));
    expect(screen.getByLabelText("Newsletter")).toBe(field(`answers.custom.${CHECKBOX_ID}`));
    // An optional field says so; a required one does not.
    expect(screen.getByText(/^Téléphone/)).toHaveTextContent("Téléphone (facultatif)");
    expect(screen.getByText(/^Prénom/)).toHaveTextContent(/^Prénom$/);
  });

  test("FRM-045 only optional fields are marked facultatif", () => {
    renderForm(
      {},
      publicEventForm({
        custom_fields: [
          { id: TEXT_ID, kind: "text", label: "Entreprise", required: true, help: "Le nom sur votre devis." },
          { id: LONG_ID, kind: "long_text", label: "Message", required: false },
        ],
      }),
    );
    const labelOf = (path: string) => document.querySelector(`label[for="${field(path).id}"]`);
    for (const path of ["answers.first_name", "answers.last_name", "answers.email", `answers.custom.${TEXT_ID}`]) {
      expect(labelOf(path)?.querySelector(".fm-opt"), path).toBeNull();
    }
    for (const path of ["answers.birth_date", "answers.phone", `answers.custom.${LONG_ID}`]) {
      expect(labelOf(path)?.querySelector(".fm-opt"), path).toHaveTextContent("(facultatif)");
    }
    for (const input of screen.getAllByTestId(/^field-answers\./)) {
      expect(input, input.dataset.testid).toHaveClass("fm-input");
    }
    // The help is a hint tied to its field.
    const help = screen.getByText("Le nom sur votre devis.");
    expect(help).toHaveClass("fm-hint");
    expect(field(`answers.custom.${TEXT_ID}`)).toHaveAccessibleDescription("Le nom sur votre devis.");
    // The first and last names sit side by side.
    expect(field("answers.first_name").closest(".fm-row2")).toBe(field("answers.last_name").closest(".fm-row2"));
    expect(field("answers.first_name").closest(".fm-row2")).not.toBeNull();
  });

  test("FRM-039 FRM-043 a datetime field is a datetime-local input", () => {
    const id = "0198c8a1-0000-7000-8000-000000000005";
    const props = renderForm(
      {},
      publicEventForm({
        custom_fields: [{ id, kind: "datetime", label: "Rendez-vous souhaité", required: false }],
      }),
    );
    const input = field(`answers.custom.${id}`);
    expect(input).toHaveAttribute("type", "datetime-local");
    expect(screen.getByLabelText(/^Rendez-vous souhaité/)).toBe(input);
    fireEvent.change(input, { target: { value: "2027-03-20T14:30" } });
    expect(props.onEdit).toHaveBeenCalledWith({ field: "custom", id, value: "2027-03-20T14:30" });
  });

  test("FRM-021 a single choice offers its options and a help text describes its field", () => {
    const form = publicEventForm({
      custom_fields: [
        { id: CHOICE_ID, kind: "single_choice", label: "Formule", required: true, options: ["Essentielle", "Prestige"], help: "Une seule réponse." },
      ],
    });
    renderForm({}, form);
    const select = field(`answers.custom.${CHOICE_ID}`);
    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "Choisissez une option",
      "Essentielle",
      "Prestige",
    ]);
    expect(select).toHaveAccessibleDescription("Une seule réponse.");
  });

  test("FRM-006 FRM-037 the consent checkbox is labelled by the exact text", () => {
    const text = "En cochant cette case, j’accepte que Alice Durand (Atelier Durand & Fils) conserve…\nÉcrivez-moi.";
    const props = renderForm({}, publicEventForm({ consent_text: text }));
    const checkbox = screen.getByTestId("consent-checkbox");
    expect(checkbox).toHaveAttribute("type", "checkbox");
    expect(checkbox).not.toBeChecked();
    expect(screen.getByTestId("consent-text").textContent).toBe(text);
    expect(checkbox).toHaveAccessibleName(text);
    fireEvent.click(checkbox);
    expect(props.onEdit).toHaveBeenCalledWith({ field: "consent", value: true });
  });

  test("ABU-002 ABU-005 the honeypot is off-screen, untabbable and hidden from screen readers", () => {
    renderForm();
    const trap = document.querySelector<HTMLInputElement>("input[name='fax']");
    expect(trap).not.toBeNull();
    expect(trap).toHaveAttribute("type", "text");
    expect(trap).toHaveAttribute("tabindex", "-1");
    expect(trap).toHaveAttribute("autocomplete", "off");
    expect(trap).toHaveValue("");
    const wrapper = trap!.closest("[aria-hidden='true']") as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.style.position).toBe("absolute");
    expect(wrapper!.style.left).toBe("-10000px");
    expect(wrapper!.style.display).not.toBe("none");
    expect(screen.queryByRole("textbox", { name: "Fax" })).toBeNull();
  });

  test("FRM-015 errors sit next to each field and the input stays", () => {
    const draft = emptyLeadDraft(publicEventForm());
    draft.answers.first_name = "Éloïse";
    draft.answers.email = "eloise@";
    renderForm({
      draft,
      errors: { "answers.email": "fieldErrors.invalid_email", consent: "fieldErrors.required" },
    });
    expect(screen.getByTestId("field-error-answers.email")).toHaveTextContent("Cette adresse e-mail n'est pas valide.");
    expect(field("answers.email")).toHaveAttribute("aria-invalid", "true");
    expect(field("answers.email")).toHaveAccessibleDescription("Cette adresse e-mail n'est pas valide.");
    expect(field("answers.email")).toHaveValue("eloise@");
    expect(field("answers.first_name")).toHaveValue("Éloïse");
    expect(field("answers.first_name")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByTestId("field-error-consent")).toHaveTextContent("Ce champ est obligatoire.");
  });

  test("FRM-015 a refused submission puts the focus on the first invalid field", () => {
    const props = renderForm({ errors: { "answers.email": "fieldErrors.required" }, attempt: 1 });
    expect(field("answers.email")).toHaveFocus();
    fireEvent.change(field("answers.first_name"), { target: { value: "Zoé" } });
    expect(props.onEdit).toHaveBeenCalledWith({ field: "first_name", value: "Zoé" });
    fireEvent.change(field("answers.address.city"), { target: { value: "Lyon" } });
    expect(props.onEdit).toHaveBeenCalledWith({ field: "address", part: "city", value: "Lyon" });
    fireEvent.click(field(`answers.custom.${CHECKBOX_ID}`));
    expect(props.onEdit).toHaveBeenCalledWith({ field: "custom", id: CHECKBOX_ID, value: true });
    fireEvent.submit(screen.getByTestId("event-form"));
    expect(props.onSubmit).toHaveBeenCalled();
  });

  test("FRM-040 nothing can be typed before the page reacts", () => {
    renderForm({ disabled: true });
    expect(field("answers.email")).toBeDisabled();
    expect(screen.getByTestId("consent-checkbox")).toBeDisabled();
    expect(screen.getByTestId("event-form-submit")).toBeDisabled();
  });
});
