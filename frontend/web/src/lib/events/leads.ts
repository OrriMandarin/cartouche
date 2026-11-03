import type { LeadView } from "./types";

/** How a contact is titled in a list or a detail view (LEA-017). */
export type LeadHeading = { kind: "name"; text: string } | { kind: "email"; text: string } | { kind: "unnamed" };

/**
 * spec: LEA-017, EDI-020. A contact is titled by its first and last name, otherwise by its email (which the row then
 * does not repeat), otherwise it is unnamed (the screen says so).
 */
export function leadHeading(lead: LeadView): LeadHeading {
  const name = [lead.answers.first_name, lead.answers.last_name]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(" ");
  if (name !== "") return { kind: "name", text: name };
  const email = lead.answers.email?.trim() ?? "";
  if (email !== "") return { kind: "email", text: email };
  return { kind: "unnamed" };
}
