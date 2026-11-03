/** Id of the message under a field, from the field's path in the request (`links[0].url` → `field-error-links-0-url`). */
export function fieldErrorId(path: string): string {
  return `field-error-${path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/-$/, "")}`;
}

/** What an input points to with `aria-describedby` when its field is refused (EDI-015). */
export function describedBy(path: string, message: string | undefined): string | undefined {
  return message ? fieldErrorId(path) : undefined;
}

/** The message of a refused field, shown right under it; nothing when the field is fine. */
export function FieldMessage({ path, message }: { path: string; message: string | undefined }) {
  if (!message) return null;
  const id = fieldErrorId(path);
  return (
    <p id={id} data-testid={id} role="alert" className="text-destructive text-sm">
      {message}
    </p>
  );
}
