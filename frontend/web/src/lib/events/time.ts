import { TZDate, tzOffset } from "@date-fns/tz";
import { format } from "date-fns";

const DEFAULT_ZONE = "Europe/Paris";
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** The user's time zone: the browser's, or Europe/Paris when it gives none (EVT-022). */
export function userTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_ZONE;
}

/** A name for the zone, shown next to the date fields (EVT-022). */
export function zoneLabel(zone: string): string {
  return zone.replaceAll("_", " ");
}

/** The date (`AAAA-MM-JJ`) and the time (`HH:mm`) of a local value; both empty for an empty value. */
export function splitLocalInput(local: string): { date: string; time: string } {
  const [date = "", time = ""] = local.split("T");
  return { date, time };
}

/** The local value of a date and a time: a date alone starts at midnight, a time without a date stands for nothing. */
export function joinLocalInput(date: string, time: string): string {
  return date === "" ? "" : `${date}T${time || "00:00"}`;
}

/** An instant as the value of an `<input type="datetime-local">` in `zone`: `AAAA-MM-JJTHH:mm`. */
export function toLocalInput(iso: string, zone: string): string {
  return format(new TZDate(iso, zone), "yyyy-MM-dd'T'HH:mm");
}

/**
 * The UTC instant (ISO 8601) of a `datetime-local` value read in `zone` (EVT-007).
 * A time that does not exist (spring forward) moves forward one hour, and a time that exists twice
 * (fall back) is its first occurrence (EVT-023).
 */
export function fromLocalInput(local: string, zone: string): string {
  const parts = LOCAL_INPUT.exec(local);
  if (!parts) throw new RangeError(`Not a local date and time: "${local}"`);
  const numbers = parts.slice(1).map((part) => Number(part ?? 0));
  const [year, month, day, hour, minute, second] = numbers as [number, number, number, number, number, number];
  // The wall clock read as if it were UTC; each candidate offset moves it to a real instant.
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetBefore = tzOffset(zone, new Date(wallClock - DAY_MS));
  const offsetAfter = tzOffset(zone, new Date(wallClock + DAY_MS));
  const instants = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => ({ offset, instant: wallClock - offset * MINUTE_MS }))
    .filter(({ offset, instant }) => tzOffset(zone, new Date(instant)) === offset)
    .map(({ instant }) => instant);
  // No instant: the time falls in a gap, and the offset in force before the gap puts it one hour later.
  const instant = instants.length > 0 ? Math.min(...instants) : wallClock - offsetBefore * MINUTE_MS;
  return new Date(instant).toISOString();
}

/** An event date for the screen, in French and in `zone`: « 15 mars 2027 à 11:00 » (EVT-007). */
export function formatEventDate(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: zone }).format(
    new Date(iso),
  );
}

const shortDate = (zone: string, weekday: boolean) =>
  new Intl.DateTimeFormat("fr-FR", {
    weekday: weekday ? "short" : undefined,
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: zone,
  });
const shortTime = (zone: string) =>
  new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: zone });

/** A contact's date in the table, in French and in `zone`: « 7 févr. 2027 · 16:42 » (LEA-014). */
export function formatLeadRowDate(iso: string, zone: string): string {
  const date = new Date(iso);
  return `${shortDate(zone, false).format(date)} · ${shortTime(zone).format(date)}`;
}

/** A moment of a contact in `zone`: « Dim. 7 févr. 2027 à 16:42 » with the weekday, « 7 févr. 2027 à 16:42 » without (LEA-003). */
export function formatLeadMoment(iso: string, zone: string, withWeekday: boolean): string {
  const date = new Date(iso);
  const day = shortDate(zone, withWeekday).format(date);
  return `${day.charAt(0).toLocaleUpperCase("fr-FR")}${day.slice(1)} à ${shortTime(zone).format(date)}`;
}
