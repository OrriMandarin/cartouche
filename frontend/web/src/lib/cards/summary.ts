import type { CardView } from "./types";

export type EventSummaryPart = { key: "running" | "upcoming"; count: number };

/**
 * spec: EDI-023. What the card list says about a card's events: the running and upcoming counts that are not
 * zero, in that order. An empty result means "no event to come".
 */
export function eventSummary(counts: Pick<CardView["event_counts"], "running" | "upcoming">): EventSummaryPart[] {
  const parts: EventSummaryPart[] = [
    { key: "running", count: counts.running },
    { key: "upcoming", count: counts.upcoming },
  ];
  return parts.filter((part) => part.count > 0);
}
