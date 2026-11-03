import type { PublicCard } from "@/templates/contract";

/** Addresses the template links to; every variable part is percent-encoded. */
export function buildCardUrls(card: PublicCard) {
  return {
    vcard: card.vcard_url,
    eventForm: (eventId: string) =>
      `/c/${encodeURIComponent(card.slug)}/e/${encodeURIComponent(eventId)}`,
  };
}
