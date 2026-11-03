import { createApiClient } from "@cartouche/api-client";
import type { LeadSubmission, PublicEventForm } from "./types";

/** The public API as a prospect's browser reaches it: same origin, through the `/api` rewrite, no token. */
function publicClient() {
  return createApiClient({ baseUrl: "", getToken: async () => null });
}

function eventPath(slug: string, eventId: string) {
  return { params: { path: { slug, event_id: eventId } } };
}

/** The form of an event for a code (any code for an event without one); a refusal is thrown as an `ApiError`. */
export async function unlockEvent(slug: string, eventId: string, accessCode: string): Promise<PublicEventForm> {
  const { data } = await publicClient().POST("/api/public/cards/{slug}/events/{event_id}/unlock", {
    ...eventPath(slug, eventId),
    body: { access_code: accessCode },
  });
  if (!data) throw new Error("the unlock route answered without a form");
  return data;
}

/** Sends the answers; a refusal is thrown as an `ApiError`, a request that never got an answer as a `TypeError`. */
export async function submitLead(slug: string, eventId: string, body: LeadSubmission): Promise<void> {
  await publicClient().POST("/api/public/cards/{slug}/events/{event_id}/leads", { ...eventPath(slug, eventId), body });
}

/** What loading a form again gives (FRM-030). */
export type FormReload = { kind: "form"; form: PublicEventForm } | { kind: "code_required" } | { kind: "closed" };

/** Loads the form again, with the code already typed for an event that has one. */
export async function reloadForm(slug: string, eventId: string, accessCode: string | null): Promise<FormReload> {
  if (accessCode !== null) return { kind: "form", form: await unlockEvent(slug, eventId, accessCode) };
  const { data } = await publicClient().GET("/api/public/cards/{slug}/events/{event_id}", eventPath(slug, eventId));
  if (!data) throw new Error("the event route answered without an event");
  if (data.state === "open") return { kind: "form", form: data.event };
  return { kind: data.state };
}
