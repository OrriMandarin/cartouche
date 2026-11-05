import type { CardView } from "@/lib/cards/types";
import type { EventView, LeadView } from "./types";

/** One entry of the scope bar: the whole card (`eventId` null) or one event, with the contacts it holds. */
export type ScopeTab = { eventId: string | null; title: string | null; count: number };

/** spec: EDI-031. The card asked for in the address when the user has it, otherwise the first card. */
export function selectedCard(cards: CardView[], requestedId: string | null): CardView | null {
  return cards.find((card) => card.id === requestedId) ?? cards[0] ?? null;
}

/** spec: EDI-031. The event asked for in the address when the card has it, otherwise the whole card (`null`). */
export function selectedEventId(events: EventView[], requestedId: string | null): string | null {
  return events.find((event) => event.id === requestedId)?.id ?? null;
}

/** spec: EDI-031. The contacts of the scope: those of one event, or all of them for the whole card (`null`). */
export function leadsInScope(leads: LeadView[], eventId: string | null): LeadView[] {
  return eventId === null ? leads : leads.filter((lead) => lead.event_id === eventId);
}

/** spec: EDI-031. The whole card, then each event from the latest to the earliest, each with its number of contacts. */
export function scopeTabs(events: EventView[], leads: LeadView[]): ScopeTab[] {
  const byStart = [...events].sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  return [
    { eventId: null, title: null, count: leads.length },
    ...byStart.map((event) => ({
      eventId: event.id,
      title: event.title,
      count: leadsInScope(leads, event.id).length,
    })),
  ];
}

/** spec: EDI-031. The address of the contacts page for a card and a scope (`null` event: the whole card). */
export function contactsHref(cardId: string, eventId: string | null): string {
  const query = new URLSearchParams({ card: cardId });
  if (eventId !== null) query.set("event", eventId);
  return `/dashboard/contacts?${query.toString()}`;
}
