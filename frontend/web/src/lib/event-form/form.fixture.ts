import type { PublicEventForm } from "./types";

export const TEXT_ID = "0198d000-0000-7000-8000-0000000000a1";
export const LONG_ID = "0198d000-0000-7000-8000-0000000000a2";
export const DATE_ID = "0198d000-0000-7000-8000-0000000000a3";
export const NUMBER_ID = "0198d000-0000-7000-8000-0000000000a4";
export const CHOICE_ID = "0198d000-0000-7000-8000-0000000000a5";
export const CHECKBOX_ID = "0198d000-0000-7000-8000-0000000000a6";

/** The form of a prospect with every standard field and one custom field of each kind, for tests. */
export function publicEventForm(overrides: Partial<PublicEventForm> = {}): PublicEventForm {
  return {
    id: "0198d000-0000-7000-8000-000000000001",
    title: "Salon de l’Artisanat ✨",
    description: null,
    form_version: "00112233445566ff",
    consent_text: "J’accepte d’être recontacté·e.",
    standard_fields: [
      { field: "first_name", required: true },
      { field: "last_name", required: true },
      { field: "birth_date", required: false },
      { field: "email", required: true },
      { field: "phone", required: false },
      { field: "address", required: false },
    ],
    custom_fields: [
      { id: TEXT_ID, kind: "text", label: "Entreprise", required: false },
      { id: LONG_ID, kind: "long_text", label: "Votre projet", required: false },
      { id: DATE_ID, kind: "date", label: "Date de livraison", required: false },
      { id: NUMBER_ID, kind: "number", label: "Budget", required: false },
      { id: CHOICE_ID, kind: "single_choice", label: "Formule", required: false, options: ["Standard", "Premium"] },
      { id: CHECKBOX_ID, kind: "checkbox", label: "Newsletter", required: false },
    ],
    ...overrides,
  };
}
