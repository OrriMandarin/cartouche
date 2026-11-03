import type { LeadDraft } from "./answers";

function key(eventId: string): string {
  return `cartouche.lead.${eventId}`;
}

function storage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined; // Access itself can throw when site data is blocked.
  }
}

const ANSWER_KEYS = ["first_name", "last_name", "birth_date", "email", "phone"] as const;
const ADDRESS_KEYS = ["street", "postal_code", "city", "country"] as const;

/** An object with a string under each of `keys`. */
function hasStrings(value: unknown, keys: readonly string[]): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return keys.every((key) => typeof record[key] === "string");
}

function isDraft(value: unknown): value is LeadDraft {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Partial<Record<keyof LeadDraft, unknown>>;
  const { answers, custom } = draft;
  return (
    hasStrings(answers, ANSWER_KEYS) &&
    hasStrings((answers as { address?: unknown }).address, ADDRESS_KEYS) &&
    typeof custom === "object" &&
    custom !== null &&
    Object.values(custom).every((item) => typeof item === "string" || typeof item === "boolean") &&
    typeof draft.consent === "boolean" &&
    typeof draft.fax === "string"
  );
}

/** What the prospect typed in this tab for an event, or `null` (FRM-040). */
export function loadDraft(eventId: string): LeadDraft | null {
  try {
    const raw = storage()?.getItem(key(eventId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Keeps the draft for a reload; a storage that refuses is not an error, the typed text stays on screen. */
export function saveDraft(eventId: string, draft: LeadDraft): void {
  try {
    storage()?.setItem(key(eventId), JSON.stringify(draft));
  } catch {
    // Private mode or full storage: nothing to keep.
  }
}

/** Forgets the draft after a successful submission. */
export function clearDraft(eventId: string): void {
  try {
    storage()?.removeItem(key(eventId));
  } catch {
    // Nothing to clear.
  }
}
