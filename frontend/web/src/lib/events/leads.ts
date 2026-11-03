import type { LeadView } from "./types";

/**
 * How a contact is named in the list (EDI-020): first and last name, otherwise the email,
 * otherwise `null` (the screen then says the contact has no name).
 */
export function leadDisplayName(lead: LeadView): string | null {
  const name = [lead.answers.first_name, lead.answers.last_name]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(" ");
  if (name !== "") return name;
  return lead.answers.email?.trim() || null;
}
