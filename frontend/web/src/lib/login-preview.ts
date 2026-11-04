import type { PublicCard, PublicEvent } from "@/templates/contract";

/** The card shown next to the sign-in block: it says what Cartouche makes. No media, so nothing to load. */
export const loginPreviewCard: PublicCard = {
  slug: "camille-roche",
  public_url: "https://cartouche.example/c/camille-roche",
  template: "classique",
  settings: {},
  theme: { preset: "terracotta" },
  content: {
    first_name: "Camille",
    last_name: "Roche",
    job_title: "Photographe de mariage",
    company: "Studio Basalte · Clermont-Ferrand",
    description: null,
    email: null,
    phone: null,
    phone_display: null,
  },
  links: [],
  header: null,
  avatar: null,
  vcard_url: "/api/public/cards/camille-roche/vcard",
  events: [],
};

export function loginPreviewEvents(title: string): PublicEvent[] {
  return [{ id: "preview", title, startsAt: "2000-01-01T00:00:00Z" }];
}
