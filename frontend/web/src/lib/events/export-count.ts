import type { LeadView } from "./types";

/** The contacts of a scope, and how many of them are marked as spam. */
export type LeadCounts = { total: number; spam: number };

/** spec: LEA-035. The contacts of a scope and the spam ones among them. */
export function countLeads(leads: LeadView[]): LeadCounts {
  return { total: leads.length, spam: leads.filter((lead) => lead.spam).length };
}

/** spec: LEA-012, LEA-035. The contacts an export holds: all of them, or all but the spam ones (the default). */
export function exportCount({ total, spam }: LeadCounts, includeSpam: boolean): number {
  return includeSpam ? total : total - spam;
}

/** What the export dialog announces about its scope: the card, the event (`null` for the whole card) and the contacts. */
export type ExportSummary = { cardSlug: string; eventTitle: string | null; counts: LeadCounts };
