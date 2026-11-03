// Percent-encodes what would change the meaning of a mailto: URL. The backend accepts `?`, `#` and
// `%` in an address, and `?`/`&` would start or add header fields (subject, cc, body).
const UNSAFE_IN_MAILTO = /[%?#&,\s\u0000-\u001f\u007f]/g;

/** `mailto:` URL opening the mail app on the address, whatever characters it holds (PUB-021). */
export function mailtoHref(email: string): string {
  return `mailto:${email.replace(UNSAFE_IN_MAILTO, (char) => encodeURIComponent(char))}`;
}

/** `tel:` URL calling an E.164 number (PUB-021); anything but digits and a leading `+` is dropped. */
export function telHref(e164: string): string {
  const trimmed = e164.trim();
  const digits = trimmed.replace(/\D/g, "");
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}
