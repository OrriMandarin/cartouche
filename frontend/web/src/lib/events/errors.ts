import { ApiError } from "@cartouche/api-client";

const KNOWN = ["too_many_simultaneous_events", "event_not_running"];

/** Message key of the refusals an owner can act on (EVT-018, EVT-021); `null` for any other failure. */
export function eventErrorKey(error: unknown): string | null {
  return error instanceof ApiError && KNOWN.includes(error.code) ? `events.errors.${error.code}` : null;
}
