import type { EventView } from "./types";

export interface EventGroups {
  running: EventView[];
  upcoming: EventView[];
  past: EventView[];
}

function byStart(a: EventView, b: EventView): number {
  return Date.parse(a.starts_at) - Date.parse(b.starts_at);
}

/**
 * The events of a card by phase (EDI-009), as the server computed it (EVT-020): the browser's clock
 * never decides. Running and upcoming ones come by start, the earliest first; past ones the latest first.
 */
export function groupEvents(events: EventView[]): EventGroups {
  const ordered = [...events].sort(byStart);
  return {
    running: ordered.filter((event) => event.phase === "running"),
    upcoming: ordered.filter((event) => event.phase === "upcoming"),
    past: ordered.filter((event) => event.phase === "past").reverse(),
  };
}

/** « Terminer maintenant » is offered on running events only (EVT-006, EVT-021). */
export function canEndNow(event: EventView): boolean {
  return event.phase === "running";
}
