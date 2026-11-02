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
