import type { EventView } from "./types";

/** An event as the API returns it, for tests. */
export function eventView(overrides: Partial<EventView> = {}): EventView {
  return {
    id: "0198d000-0000-7000-8000-000000000001",
    card_id: "0198c8a0-0000-7000-8000-000000000001",
    title: "Salon de l’Artisanat ✨",
    description: null,
    starts_at: "2027-03-15T10:00:00Z",
    ends_at: null,
    access_code: null,
    device_limit: 1,
    standard_fields: {
      first_name: "required",
      last_name: "required",
      birth_date: "off",
      email: "required",
      phone: "optional",
      address: "off",
    },
    custom_fields: [],
    consent_text: null,
    default_consent_text: "Texte de consentement par défaut.",
    phase: "upcoming",
    lead_count: 0,
    created_at: "2027-03-01T08:00:00Z",
    updated_at: "2027-03-01T08:00:00Z",
    ...overrides,
  };
}
