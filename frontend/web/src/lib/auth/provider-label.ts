const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  apple: "Apple",
  microsoft: "Microsoft",
  github: "GitHub",
  facebook: "Facebook",
  linkedin: "LinkedIn",
};

/** spec: ACC-019. The brand name of the identity provider a user signed in with, `null` when it is unknown. */
export function signInProviderLabel(provider: string | undefined): string | null {
  if (!provider) return null;
  return PROVIDER_LABELS[provider.replace(/^oauth_/, "")] ?? null;
}
