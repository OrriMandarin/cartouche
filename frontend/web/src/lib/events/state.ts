import { formatEventDate } from "./time";
import type { EventView } from "./types";

/** The message (under `events.state`) and values that tell where an event stands in time (EDI-019). */
export function eventStateLine(
  event: EventView,
  zone: string,
): { key: "running" | "runningOpen" | "upcoming" | "upcomingOpen" | "past"; values: { start: string; end?: string } } {
  const start = formatEventDate(event.starts_at, zone);
  if (!event.ends_at) {
    return { key: event.phase === "upcoming" ? "upcomingOpen" : "runningOpen", values: { start } };
  }
  return { key: event.phase, values: { start, end: formatEventDate(event.ends_at, zone) } };
}
