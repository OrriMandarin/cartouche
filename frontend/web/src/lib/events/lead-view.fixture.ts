import type { LeadView } from "./types";

/** A contact as the API returns it, for tests. */
export function leadView(overrides: Partial<LeadView> = {}): LeadView {
  return {
    id: "0198c8a3-0000-7000-8000-000000000001",
    event_id: "0198d000-0000-7000-8000-000000000001",
    event_title: "Salon du Mariage",
    submitted_at: "2027-03-15T09:30:00Z",
    spam: false,
    answers: { first_name: "Éloïse", last_name: "D’Aubigné-Müller", email: "eloise@example.test", phone: "+33612345678" },
    phone_display: "+33 6 12 34 56 78",
    custom: [],
    consent_at: "2027-03-15T09:30:00Z",
    consent_text: "Texte de consentement par défaut.",
    ...overrides,
  };
}
