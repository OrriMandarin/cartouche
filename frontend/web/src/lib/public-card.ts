import { ApiError, createApiClient, type components } from "@cartouche/api-client";
import { cache } from "react";
import { serverApiBaseUrl } from "./server-api";

// Lives in its own module so the editor (a client bundle) can use it without this one's server-only `cache`.
export { buildCardUrls } from "./card-urls";

export type PublicCardResponse = components["schemas"]["PublicCardResponse"];

/**
 * What a visitor gets for a slug, or `null` when it was never attributed (LNK-023). Every other state is in the
 * response (`active`, `inactive`, `redirect`). Wrapped in `cache` so the page and `generateMetadata` share one
 * request; never stored (`no-store`), a disabled card must stop being served at once (LNK-006).
 */
export const fetchPublicCard = cache(async (slug: string): Promise<PublicCardResponse | null> => {
  const client = createApiClient({
    baseUrl: serverApiBaseUrl(),
    getToken: async () => null,
    fetch: (request) => fetch(request, { cache: "no-store" }),
  });
  try {
    const { data } = await client.GET("/api/public/cards/{slug}", { params: { path: { slug } } });
    return data ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
});
