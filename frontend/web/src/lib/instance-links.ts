// The instance's contact points (ADM-021): set by configuration of the web application, with placeholders
// that a production instance replaces. Each variable is named in full so that Next inlines it in the bundle.

const DEFAULT_SUPPORT_EMAIL = "support@cartouche.invalid";
const DEFAULT_TERMS_URL = "/cgu";
const DEFAULT_PRIVACY_URL = "/confidentialite";

/** An empty variable counts as absent. */
function configured(value: string | undefined, fallback: string): string {
  return value ? value : fallback;
}

export function supportEmail(): string {
  return configured(process.env.NEXT_PUBLIC_SUPPORT_EMAIL, DEFAULT_SUPPORT_EMAIL);
}

/** The address of every "Contacter le support" link. */
export function supportMailto(): string {
  return `mailto:${encodeURIComponent(supportEmail())}`;
}

export function termsUrl(): string {
  return configured(process.env.NEXT_PUBLIC_TERMS_URL, DEFAULT_TERMS_URL);
}

export function privacyUrl(): string {
  return configured(process.env.NEXT_PUBLIC_PRIVACY_URL, DEFAULT_PRIVACY_URL);
}
