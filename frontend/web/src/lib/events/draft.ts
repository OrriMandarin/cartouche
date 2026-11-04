import { fieldErrors } from "@/lib/cards/draft";
import { MAX_OPTIONS } from "./fields";
import { fromLocalInput, toLocalInput } from "./time";
import type { CustomFieldKind, EventInput, EventView, StandardFields } from "./types";

const HOUR_MS = 3_600_000;

/** A custom field while the owner edits it. Its `id` is stable and travels to the server (FRM-032). */
export interface CustomFieldDraft {
  id: string;
  label: string;
  kind: CustomFieldKind;
  required: boolean;
  help: string;
  options: string[];
}

/** What the event editor holds while the owner types: every text is a string, empty when absent. */
export interface EventDraft {
  title: string;
  description: string;
  /** Local date and time, as an `<input type="datetime-local">` holds it. */
  startsAt: string;
  /** Local date and time, or `""` when the event has no end. */
  endsAt: string;
  accessCode: string;
  deviceLimit: string;
  standardFields: StandardFields;
  customFields: CustomFieldDraft[];
  consentMode: "default" | "custom";
  consentText: string;
}

/** A blank event: starts at the next full hour, one submission per device, the usual fields (EVT-014, FRM-019). */
export function newEventDraft(zone: string, now: Date): EventDraft {
  const currentHour = fromLocalInput(`${toLocalInput(now.toISOString(), zone).slice(0, 13)}:00`, zone);
  const nextHour = new Date(Date.parse(currentHour) + HOUR_MS).toISOString();
  return {
    title: "",
    description: "",
    startsAt: toLocalInput(nextHour, zone),
    endsAt: "",
    accessCode: "",
    deviceLimit: "1",
    standardFields: {
      first_name: "required",
      last_name: "required",
      birth_date: "off",
      email: "required",
      phone: "optional",
      address: "off",
    },
    customFields: [],
    consentMode: "default",
    consentText: "",
  };
}

/** The draft of an event as the server stores it, its dates read in `zone`. */
export function draftFromEvent(event: EventView, zone: string): EventDraft {
  const consentText = event.consent_text ?? "";
  return {
    title: event.title,
    description: event.description ?? "",
    startsAt: toLocalInput(event.starts_at, zone),
    endsAt: event.ends_at ? toLocalInput(event.ends_at, zone) : "",
    accessCode: event.access_code ?? "",
    deviceLimit: String(event.device_limit),
    standardFields: event.standard_fields,
    customFields: event.custom_fields.map((field) => ({
      id: field.id,
      label: field.label,
      kind: field.kind,
      required: field.required,
      help: field.help ?? "",
      options: field.options ?? [],
    })),
    consentMode: consentText.trim() === "" ? "default" : "custom",
    consentText,
  };
}

/** An empty text is an absent one (the server reads it the same way). */
function orNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}

/**
 * The device limit as a number. What is not a whole number becomes 0, which the server refuses with
 * `device_limit: out_of_range` (EVT-030): the server stays the arbiter.
 */
function deviceLimitOf(text: string): number {
  const limit = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(limit) ? limit : 0;
}

/** The body of an event as the server reads it, the instants given by `instantOf` (empty dates are absent). */
function bodyOf(draft: EventDraft, instantOf: (local: string) => string): EventInput {
  return {
    title: draft.title,
    description: orNull(draft.description),
    starts_at: draft.startsAt === "" ? null : instantOf(draft.startsAt),
    ends_at: draft.endsAt === "" ? null : instantOf(draft.endsAt),
    access_code: orNull(draft.accessCode),
    device_limit: deviceLimitOf(draft.deviceLimit),
    standard_fields: draft.standardFields,
    custom_fields: draft.customFields.map((field) => ({
      id: field.id,
      label: field.label,
      kind: field.kind,
      required: field.required,
      help: orNull(field.help),
      options: field.kind === "single_choice" ? field.options : [],
    })),
    consent_text: draft.consentMode === "custom" ? orNull(draft.consentText) : null,
  };
}

/**
 * The body of `POST`/`PUT` for an event, its dates read in `zone` (EVT-007). A missing start goes as `null`
 * and the server reports it as `starts_at: required`.
 */
export function draftToBody(draft: EventDraft, zone: string): EventInput {
  return bodyOf(draft, (local) => fromLocalInput(local, zone));
}

/**
 * spec: EDI-021. Whether `draft` differs from the `saved` one as the server would read them (an empty text is
 * an absent one, abandoned custom consent text is ignored): undoing an edit makes the draft clean again.
 * The dates are compared as typed, so a value the browser accepts but no instant stands for (a five-digit
 * year) is a change, not an error: this runs on every render.
 */
export function isEventDraftDirty(saved: EventDraft, draft: EventDraft): boolean {
  const asTyped = (local: string) => local;
  return JSON.stringify(bodyOf(saved, asTyped)) !== JSON.stringify(bodyOf(draft, asTyped));
}

/**
 * Adds an empty custom field of `kind` at the end, with a fresh stable id (FRM-032). A single choice
 * field starts with its two empty options (FRM-021).
 */
export function addCustomField(draft: EventDraft, kind: CustomFieldKind): EventDraft {
  const options = kind === "single_choice" ? ["", ""] : [];
  const field: CustomFieldDraft = { id: crypto.randomUUID(), label: "", kind, required: false, help: "", options };
  return { ...draft, customFields: [...draft.customFields, field] };
}

function withField(draft: EventDraft, index: number, change: (field: CustomFieldDraft) => CustomFieldDraft): EventDraft {
  return { ...draft, customFields: draft.customFields.map((field, i) => (i === index ? change(field) : field)) };
}

/** Changes the label, help or required flag of the custom field at `index`; its id and kind stay (FRM-032). */
export function updateCustomField(
  draft: EventDraft,
  index: number,
  patch: Partial<Pick<CustomFieldDraft, "label" | "help" | "required">>,
): EventDraft {
  return withField(draft, index, (field) => ({ ...field, ...patch }));
}

/** Adds an empty option to the single choice field at `index`, up to the limit (FRM-032). */
export function addOption(draft: EventDraft, index: number): EventDraft {
  return withField(draft, index, (field) =>
    field.options.length >= MAX_OPTIONS ? field : { ...field, options: [...field.options, ""] },
  );
}

/** Types the option `option` of the custom field at `index`. */
export function setOption(draft: EventDraft, index: number, option: number, text: string): EventDraft {
  return withField(draft, index, (field) => ({
    ...field,
    options: field.options.map((current, i) => (i === option ? text : current)),
  }));
}

/** Removes the option `option` of the custom field at `index`. */
export function removeOption(draft: EventDraft, index: number, option: number): EventDraft {
  return withField(draft, index, (field) => ({ ...field, options: field.options.filter((_, i) => i !== option) }));
}

/**
 * The event gets an end, one hour after its start unless one was typed. Without a start there is
 * nothing to count from, and the end stays empty (the owner picks it).
 */
export function enableEnd(draft: EventDraft, zone: string): EventDraft {
  if (draft.endsAt !== "" || draft.startsAt === "") return draft;
  const start = Date.parse(fromLocalInput(draft.startsAt, zone));
  return { ...draft, endsAt: toLocalInput(new Date(start + HOUR_MS).toISOString(), zone) };
}

/** Moves the custom field at `index` by `delta` places (FRM-020); out of range, nothing moves. */
export function moveCustomField(draft: EventDraft, index: number, delta: number): EventDraft {
  const target = index + delta;
  const last = draft.customFields.length - 1;
  if (index < 0 || index > last || target < 0 || target > last) return draft;
  const customFields = [...draft.customFields];
  customFields.splice(target, 0, ...customFields.splice(index, 1));
  return { ...draft, customFields };
}

/** Removes the custom field at `index`. */
export function removeCustomField(draft: EventDraft, index: number): EventDraft {
  return { ...draft, customFields: draft.customFields.filter((_, position) => position !== index) };
}

/**
 * Message keys by field path (`starts_at`, `custom_fields[2].label`…) for a failed save (EDI-019).
 * The paths are the server's, so they are also the ones the editor reads.
 */
export function eventFieldErrors(error: unknown): Record<string, string> {
  return fieldErrors(error);
}

/**
 * The messages without the ones of `paths` and of the fields below them (`custom_fields[1].options` takes
 * `custom_fields[1].options[0]` with it): the owner corrected them (EDI-015). Returns `errors` itself when
 * nothing goes.
 */
export function clearErrors(errors: Record<string, string>, paths: string[]): Record<string, string> {
  const gone = (path: string) =>
    paths.some((fixed) => path === fixed || path.startsWith(`${fixed}[`) || path.startsWith(`${fixed}.`));
  const kept = Object.entries(errors).filter(([path]) => !gone(path));
  return kept.length === Object.keys(errors).length ? errors : Object.fromEntries(kept);
}
