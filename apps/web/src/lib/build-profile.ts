export type BuildProfile = "development" | "test" | "production";
export type AuthProviderName = "clerk" | "oidc" | "test";

const PROFILES: readonly BuildProfile[] = ["development", "test", "production"];
const PROVIDERS: readonly AuthProviderName[] = ["clerk", "oidc", "test"];

/** spec: ACC-008. Missing or unknown profile means production. */
export function resolveBuildConfig(env: { profile?: string; authProvider?: string }): {
  profile: BuildProfile;
  authProvider: AuthProviderName;
} {
  const profile = PROFILES.find((p) => p === env.profile) ?? "production";

  const rawProvider = env.authProvider === undefined || env.authProvider === "" ? "clerk" : env.authProvider;
  const authProvider = PROVIDERS.find((p) => p === rawProvider);
  if (authProvider === undefined) {
    throw new Error(`Unknown auth provider "${rawProvider}" (expected one of: ${PROVIDERS.join(", ")})`);
  }

  if (authProvider === "test" && profile === "production") {
    throw new Error("The test auth provider cannot be used with the production build profile");
  }

  return { profile, authProvider };
}

/**
 * Rewrites are baked into the Next build, so the API URL must be known at build time.
 * Development and test builds fall back to the local API; production must set it explicitly.
 */
export function resolveApiInternalUrl(profile: BuildProfile, value: string | undefined): string {
  const url = value?.trim();
  if (url !== undefined && url !== "") return url;
  if (profile === "production") {
    throw new Error("API_INTERNAL_URL must be set for the production build profile");
  }
  return "http://localhost:8080";
}
