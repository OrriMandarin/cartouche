import type { components } from "@cartouche/api-client";

export type PublicEventForm = components["schemas"]["PublicEventForm"];
export type PublicCustomField = PublicEventForm["custom_fields"][number];
export type LeadSubmission = components["schemas"]["LeadSubmission"];
