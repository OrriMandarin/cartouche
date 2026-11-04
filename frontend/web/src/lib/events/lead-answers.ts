import type { AnswerSnapshot } from "./types";

/** How an answer is shown; the component turns `yes`, `no` and `empty` into interface texts. */
export type AnswerDisplay = { kind: "text"; text: string } | { kind: "yes" } | { kind: "no" } | { kind: "empty" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;
const frenchDate = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC" });
const frenchNumber = new Intl.NumberFormat("fr-FR");

/** spec: LEA-019. A `YYYY-MM-DD` date as a French date (`18/09/2027`), never shifted by the viewer's zone. */
export function displayBirthDate(iso: string): string {
  if (!ISO_DATE.test(iso)) return iso;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : frenchDate.format(date);
}

/** spec: LEA-033. A `YYYY-MM-DDTHH:MM` answer as `20/03/2027 à 14:30`, exactly as entered: no time zone is applied. */
export function displayLocalDateTime(local: string): string {
  const match = LOCAL_DATE_TIME.exec(local);
  if (!match) return local;
  const date = displayBirthDate(match[1]!);
  return date === match[1] ? local : `${date} à ${match[2]}`;
}

/**
 * spec: LEA-019. A custom answer as recorded at submission (FRM-022): a checkbox is yes or no, a date a French date, a date and time a French date and time,
 * a number in French format; a field left empty is `empty`.
 */
export function displayAnswer({ kind, value }: AnswerSnapshot): AnswerDisplay {
  if (value === null || value === undefined) return { kind: "empty" };
  if (kind === "checkbox") return value === true ? { kind: "yes" } : { kind: "no" };
  if (typeof value === "number") return { kind: "text", text: frenchNumber.format(value) };
  if (typeof value !== "string" || value.trim() === "") return { kind: "empty" };
  if (kind === "date") return { kind: "text", text: displayBirthDate(value) };
  if (kind === "datetime") return { kind: "text", text: displayLocalDateTime(value) };
  return { kind: "text", text: value };
}
