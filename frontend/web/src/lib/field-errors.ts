import type { FieldError } from "@cartouche/api-client";

/** Message key of a field error code, in the `fieldErrors` messages every form shares. */
export function fieldErrorKey(code: string): string {
  return `fieldErrors.${code}`;
}

/** Message keys by field path for the fields of a `400 validation_failed`; the first error of a path wins. */
export function fieldErrorKeys(fields: readonly FieldError[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const { field, code } of fields) {
    if (!Object.hasOwn(errors, field)) errors[field] = fieldErrorKey(code);
  }
  return errors;
}

/** Id of the message under a field, from the field's path in the request (`links[0].url` → `field-error-links-0-url`). */
export function fieldErrorId(path: string): string {
  return `field-error-${path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/-$/, "")}`;
}
