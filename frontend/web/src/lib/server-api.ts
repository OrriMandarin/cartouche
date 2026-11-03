import { parseBuildProfile, resolveApiInternalUrl } from "./build-profile";

/**
 * Base URL of the API for requests made by the web server itself (the public page is rendered there).
 * Same variable and rule as the `/api` rewrite: the local API outside production, an error in production
 * when `API_INTERNAL_URL` is missing.
 */
export function serverApiBaseUrl(): string {
  return resolveApiInternalUrl(
    parseBuildProfile(process.env.NEXT_PUBLIC_CARTOUCHE_BUILD_PROFILE),
    process.env.API_INTERNAL_URL,
  );
}
