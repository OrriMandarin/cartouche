import type { CustomFieldKind, LeadView } from "./types";

/** Custom answers the search reads (LEA-015): the free-text kinds and the single choice. */
const SEARCHABLE_KINDS: readonly CustomFieldKind[] = ["text", "long_text", "single_choice"];

/** A word made only of digits and of `+ . - ( )`, with at least one digit (LEA-016). */
const PHONE_LIKE = /^[0-9+.\-()]+$/;

/** Lower case, without accents, trimmed: the form in which words and values are compared (LEA-015). */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

function searchableTexts(lead: LeadView): string[] {
  const { first_name, last_name, email, city } = lead.answers;
  const custom = lead.custom
    .filter(({ kind }) => SEARCHABLE_KINDS.includes(kind))
    .map(({ value }) => value);
  return [first_name, last_name, email, city, ...custom]
    .filter((value): value is string => typeof value === "string")
    .map(fold);
}

/** The digits of a phone-like word without their leading zeros; empty when only zeros were typed. */
function phoneDigits(word: string): string {
  if (!PHONE_LIKE.test(word)) return "";
  return word.replace(/\D/g, "").replace(/^0+/, "");
}

/**
 * spec: LEA-015, LEA-016. Whether every word of `query` is found, ignoring case and accents, in a name, the email,
 * the city, a text answer, or (for a phone-like word) in the digits of the phone number. An empty query matches.
 */
export function leadMatches(lead: LeadView, query: string): boolean {
  const words = fold(query).split(/\s+/).filter((word) => word !== "");
  const texts = searchableTexts(lead);
  const phone = (lead.answers.phone ?? "").replace(/\D/g, "");
  return words.every((word) => {
    if (texts.some((text) => text.includes(word))) return true;
    const digits = phoneDigits(word);
    return digits !== "" && phone.includes(digits);
  });
}

/** The leads that match `query`, in their order; the whole list when the query is empty (LEA-015). */
export function filterLeads(leads: LeadView[], query: string): LeadView[] {
  return leads.filter((lead) => leadMatches(lead, query));
}
