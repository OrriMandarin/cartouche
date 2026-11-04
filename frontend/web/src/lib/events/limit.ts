import type { EventView } from "./types";

/**
 * spec: EDI-032, EVT-004. Whether the card has as many events in progress as the instance allows (`max`,
 * given by the API). The phase is the server's (EVT-020); scheduling an upcoming event stays possible.
 */
export function runningLimitReached(events: EventView[], max: number): boolean {
  return events.filter((event) => event.phase === "running").length >= max;
}
