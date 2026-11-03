import { ApiError, createApiClient, type components } from "@cartouche/api-client";
import { cache } from "react";
import { serverApiBaseUrl } from "./server-api";

export type PublicEventResponse = components["schemas"]["PublicEventResponse"];

/**
 * What a visitor gets for an event of a card, `{ state: "inactive" }` when the card is not served (410), or
 * `null` when there is no such event or the id is malformed (FRM-024). Wrapped in `cache` so the page and
 * `generateMetadata` share one request; never stored (`no-store`), a closed event or a disabled card must
 * stop being served at once.
 */
export const fetchPublicEvent = cache(
  async (slug: string, eventId: string): Promise<PublicEventResponse | { state: "inactive" } | null> => {
    const client = createApiClient({
      baseUrl: serverApiBaseUrl(),
      getToken: async () => null,
      fetch: (request) => fetch(request, { cache: "no-store" }),
    });
    try {
      const { data } = await client.GET("/api/public/cards/{slug}/events/{event_id}", {
        params: { path: { slug, event_id: eventId } },
      });
      return data ?? null;
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 404 || error.status === 400) return null;
        if (error.status === 410) return { state: "inactive" };
      }
      throw error;
    }
  },
);
