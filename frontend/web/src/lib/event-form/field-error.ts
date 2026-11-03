/** Message key of a field error code, in the `fieldErrors` messages shared with the owner's forms. */
export function fieldErrorKey(code: string): string {
  return `fieldErrors.${code}`;
}
