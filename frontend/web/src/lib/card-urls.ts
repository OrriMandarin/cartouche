import type { PublicCard } from "@/templates/contract";

/** Address of the public page of a card. */
export function cardPagePath(slug: string): string {
  return `/c/${encodeURIComponent(slug)}`;
}

/** Address of the form of an event of a card (FRM-024). */
export function eventFormPath(slug: string, eventId: string): string {
  return `${cardPagePath(slug)}/e/${encodeURIComponent(eventId)}`;
}

/** Addresses the template links to; every variable part is percent-encoded. */
export function buildCardUrls(card: PublicCard) {
  return {
    vcard: card.vcard_url,
    eventForm: (eventId: string) => eventFormPath(card.slug, eventId),
  };
}
