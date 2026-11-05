import type { LeadSubmission, PublicCustomField, PublicEventForm } from "./types";

/** What the prospect types while the form is open: every text is a string, empty when absent. */
export interface LeadDraft {
  answers: {
    first_name: string;
    last_name: string;
    birth_date: string;
    email: string;
    phone: string;
    address: { street: string; postal_code: string; city: string; country: string };
  };
  /** By custom field id: a string, or a boolean for a checkbox. */
  custom: Record<string, string | boolean>;
  consent: boolean;
  /** The hidden trap field (ABU-002): the form never fills it. */
  fax: string;
}

const DEFAULT_COUNTRY = "France";

// Limits of FRM-034, the same as the server's.
const MAX_NAME = 100;
const MAX_EMAIL = 254;
const MAX_STREET = 200;
const MAX_POSTAL_CODE = 20;
const MAX_TEXT = 500;
const MAX_LONG_TEXT = 5_000;

export type StandardAnswerKey = "first_name" | "last_name" | "birth_date" | "email" | "phone";
const ADDRESS_PARTS = ["street", "postal_code", "city", "country"] as const;
export type AddressPart = (typeof ADDRESS_PARTS)[number];
const ADDRESS_LIMITS = { street: MAX_STREET, postal_code: MAX_POSTAL_CODE, city: MAX_NAME, country: MAX_NAME };

/** Whether the form asks for a standard field, and whether it insists on it. */
function standardField(form: PublicEventForm, field: string): { required: boolean } | null {
  const found = form.standard_fields.find((candidate) => candidate.field === field);
  return found ? { required: found.required } : null;
}

/** NFC and trimmed, as the server stores it (FRM-016). */
function normalize(value: string): string {
  return value.normalize("NFC").trim();
}

function length(value: string): number {
  return [...value].length;
}

function emptyAddress(): LeadDraft["answers"]["address"] {
  return { street: "", postal_code: "", city: "", country: DEFAULT_COUNTRY };
}

function emptyCustomAnswer(field: PublicCustomField): string | boolean {
  return field.kind === "checkbox" ? false : "";
}

/** A blank draft for a form: nothing typed, consent unchecked, the country proposed (FRM-033). */
export function emptyLeadDraft(form: PublicEventForm): LeadDraft {
  return {
    answers: { first_name: "", last_name: "", birth_date: "", email: "", phone: "", address: emptyAddress() },
    custom: Object.fromEntries(form.custom_fields.map((field) => [field.id, emptyCustomAnswer(field)])),
    consent: false,
    fax: "",
  };
}

/**
 * The draft carried over to a form that changed (FRM-030): the answers to fields that still exist and fit
 * are kept, the others start blank, and the consent is unchecked since its text may have changed.
 */
export function refreshDraft(draft: LeadDraft, form: PublicEventForm): LeadDraft {
  const next = emptyLeadDraft(form);
  const keys: StandardAnswerKey[] = ["first_name", "last_name", "birth_date", "email", "phone"];
  for (const key of keys) {
    if (standardField(form, key)) next.answers[key] = draft.answers[key];
  }
  if (standardField(form, "address")) next.answers.address = { ...draft.answers.address };
  for (const field of form.custom_fields) {
    const previous = draft.custom[field.id];
    if (field.kind === "checkbox") {
      next.custom[field.id] = previous === true;
    } else if (typeof previous === "string" && (field.kind !== "single_choice" || (field.options ?? []).includes(previous))) {
      next.custom[field.id] = previous;
    }
  }
  return next;
}

/** One change the prospect makes to the draft. */
export type DraftEdit =
  | { field: StandardAnswerKey; value: string }
  | { field: "address"; part: AddressPart; value: string }
  | { field: "custom"; id: string; value: string | boolean }
  | { field: "consent"; value: boolean }
  | { field: "fax"; value: string };

/** The draft with that one change, as a new value (the given draft is left untouched). */
export function editDraft(draft: LeadDraft, edit: DraftEdit): LeadDraft {
  switch (edit.field) {
    case "address":
      return { ...draft, answers: { ...draft.answers, address: { ...draft.answers.address, [edit.part]: edit.value } } };
    case "custom":
      return { ...draft, custom: { ...draft.custom, [edit.id]: edit.value } };
    case "consent":
      return { ...draft, consent: edit.value };
    case "fax":
      return { ...draft, fax: edit.value };
    default:
      return { ...draft, answers: { ...draft.answers, [edit.field]: edit.value } };
  }
}

/** A draft and the version of the form it was typed for. */
export interface TypedDraft {
  draft: LeadDraft;
  formVersion: string;
}

/**
 * The draft to show with a form: the one being typed when it was typed for this very form (FRM-041), else what
 * still applies of it or of the draft kept for a reload, consent unchecked (FRM-030, FRM-040), else a blank one.
 */
export function resumeDraft(form: PublicEventForm, current: TypedDraft | null, stored: LeadDraft | null): LeadDraft {
  if (current?.formVersion === form.form_version) return current.draft;
  const previous = current?.draft ?? stored;
  return previous ? refreshDraft(previous, form) : emptyLeadDraft(form);
}

const EMAIL_WHITESPACE = /\s/u;

/** Mirror of the server's plausibility check: one `@`, a dotted domain with no empty label, no space. */
function isPlausibleEmail(email: string): boolean {
  if (EMAIL_WHITESPACE.test(email)) return false;
  const at = email.indexOf("@");
  if (at <= 0) return false;
  const domain = email.slice(at + 1);
  return !domain.includes("@") && domain.includes(".") && domain.split(".").every((label) => label !== "");
}

/** A date `AAAA-MM-JJ` that exists, from 1900 to 2100 (FRM-035). */
function isCalendarDate(value: string): boolean {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** A date and time `AAAA-MM-JJTHH:MM`, with no seconds and no zone, the date as `isCalendarDate` (FRM-043). */
export function isCalendarDateTime(value: string): boolean {
  const match = /^(.{10})T([0-9]{2}):([0-9]{2})$/.exec(value);
  if (!match) return false;
  const [, date = "", hour = "", minute = ""] = match;
  return isCalendarDate(date) && Number(hour) < 24 && Number(minute) < 60;
}

const DECIMAL = /^[-+]?[0-9]+(?:[.,][0-9]+)?$/;

/**
 * The answers the form asks, checked as the server will (FRM-033 to FRM-037); the server stays the judge. The
 * error codes by field path, the first of each field.
 */
export function checkLeadDraft(form: PublicEventForm, draft: LeadDraft, today: string): Record<string, string> {
  const errors: Record<string, string> = {};
  const fail = (path: string, code: string) => {
    if (!Object.hasOwn(errors, path)) errors[path] = code;
  };
  /** The normalized answer, after the required and length checks. */
  const text = (path: string, raw: string, required: boolean, max: number): string => {
    const value = normalize(raw);
    if (value === "") {
      if (required) fail(path, "required");
    } else if (length(value) > max) {
      fail(path, "too_long");
    }
    return value;
  };

  const names: [StandardAnswerKey, number][] = [
    ["first_name", MAX_NAME],
    ["last_name", MAX_NAME],
  ];
  for (const [key, max] of names) {
    const field = standardField(form, key);
    if (field) text(`answers.${key}`, draft.answers[key], field.required, max);
  }
  const birthDate = standardField(form, "birth_date");
  if (birthDate) {
    const value = text("answers.birth_date", draft.answers.birth_date, birthDate.required, Infinity);
    if (value !== "" && (!isCalendarDate(value) || value > today)) fail("answers.birth_date", "invalid_date");
  }
  const email = standardField(form, "email");
  if (email) {
    const value = text("answers.email", draft.answers.email, email.required, MAX_EMAIL);
    if (value !== "" && length(value) <= MAX_EMAIL && !isPlausibleEmail(value)) fail("answers.email", "invalid_email");
  }
  const phone = standardField(form, "phone");
  if (phone) text("answers.phone", draft.answers.phone, phone.required, Infinity);
  const address = standardField(form, "address");
  if (address) {
    for (const part of ADDRESS_PARTS) {
      text(`answers.address.${part}`, draft.answers.address[part], address.required, ADDRESS_LIMITS[part]);
    }
  }

  for (const field of form.custom_fields) {
    const path = `answers.custom.${field.id}`;
    const answer = draft.custom[field.id];
    if (field.kind === "checkbox") {
      if (field.required && answer !== true) fail(path, "required");
      continue;
    }
    const code = checkCustomText(field, typeof answer === "string" ? answer : "", text, path);
    if (code) fail(path, code);
  }

  if (!draft.consent) fail("consent", "required");
  return errors;
}

type TextChecker = (path: string, raw: string, required: boolean, max: number) => string;

/** The error code of a custom answer typed as text, if any. */
function checkCustomText(field: PublicCustomField, raw: string, text: TextChecker, path: string): string | null {
  const max = field.kind === "long_text" ? MAX_LONG_TEXT : field.kind === "text" ? MAX_TEXT : Infinity;
  const value = text(path, raw, field.required, max);
  if (value === "") return null;
  switch (field.kind) {
    case "date":
      return isCalendarDate(value) ? null : "invalid_date";
    case "datetime":
      return isCalendarDateTime(value) ? null : "invalid_date";
    case "number":
      return DECIMAL.test(value) ? null : "invalid_number";
    case "single_choice":
      return (field.options ?? []).includes(value) ? null : "invalid_choice";
    default:
      return null;
  }
}

/** The answer to a text-like standard field, left out of the body when empty. */
function present(value: string): string | undefined {
  const normalized = normalize(value);
  return normalized === "" ? undefined : normalized;
}

/**
 * A number typed with a point or a comma becomes a JSON number (FRM-036); anything else, or one too large to be
 * a finite number, is left to the server as typed.
 */
function numberAnswer(value: string): number | string {
  if (!DECIMAL.test(value)) return value;
  const number = Number(value.replace(",", "."));
  return Number.isFinite(number) ? number : value;
}

function customAnswer(field: PublicCustomField, answer: string | boolean | undefined): string | number | boolean | undefined {
  if (field.kind === "checkbox") return answer === true;
  const value = present(typeof answer === "string" ? answer : "");
  if (value === undefined) return undefined;
  return field.kind === "number" ? numberAnswer(value) : value;
}

/**
 * The body of the submission for the form the prospect saw: only the fields the form asks, empty answers left
 * out, texts normalized, numbers as numbers, boxes as booleans (FRM-016, FRM-017, FRM-036).
 */
export function draftToSubmission(
  form: PublicEventForm,
  draft: LeadDraft,
  deviceId: string,
  accessCode: string | null,
): LeadSubmission {
  const answers: LeadSubmission["answers"] = {};
  for (const key of ["first_name", "last_name", "birth_date", "email", "phone"] as const) {
    if (!standardField(form, key)) continue;
    const value = present(draft.answers[key]);
    if (value !== undefined) answers[key] = value;
  }
  if (standardField(form, "address")) {
    const parts = Object.fromEntries(
      ADDRESS_PARTS.flatMap((part) => {
        const value = present(draft.answers.address[part]);
        return value === undefined ? [] : [[part, value]];
      }),
    );
    // The proposed country alone is no answer.
    if (ADDRESS_PARTS.some((part) => part !== "country" && part in parts)) answers.address = parts;
  }
  const custom: Record<string, unknown> = {};
  for (const field of form.custom_fields) {
    const value = customAnswer(field, draft.custom[field.id]);
    if (value !== undefined) custom[field.id] = value;
  }
  answers.custom = custom;
  return {
    device_id: deviceId,
    ...(accessCode === null ? {} : { access_code: accessCode }),
    form_version: form.form_version,
    fax: draft.fax,
    consent: draft.consent,
    answers,
  };
}
