import type { CardView } from "@/lib/cards/types";

/** A card as the API returns it, for component tests. */
export function cardView(overrides: Partial<CardView> = {}): CardView {
  return {
    id: "card-1",
    slug: "alice-durand",
    public_url: "http://localhost:13000/c/alice-durand",
    status: "active",
    template: "classique",
    settings: {},
    theme: { preset: "clair" },
    content: { first_name: "Éloïse", last_name: "D'Aubigné-Müller" },
    links: [],
    created_at: "2026-03-05T12:00:00Z",
    updated_at: "2026-03-05T12:00:00Z",
    ...overrides,
  };
}
