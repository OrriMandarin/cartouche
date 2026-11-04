import { AlertCircle } from "lucide-react";
import { fieldErrorId } from "@/lib/field-errors";

export { fieldErrorId };

/**
 * What an input points to with `aria-describedby`: its hint, if any, and its message when the field is
 * refused (EDI-015).
 */
export function describedBy(path: string, message: string | undefined, hintId?: string): string | undefined {
  const ids = [hintId, message ? fieldErrorId(path) : undefined].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

/** The message of a refused field, shown right under it; nothing when the field is fine. */
export function FieldMessage({ path, message }: { path: string; message: string | undefined }) {
  if (!message) return null;
  const id = fieldErrorId(path);
  return (
    <p
      id={id}
      data-testid={id}
      role="alert"
      tabIndex={-1}
      className="text-app-danger flex items-start gap-1.5 text-[13px] leading-[1.4] font-semibold"
    >
      <AlertCircle aria-hidden="true" className="mt-px size-4 flex-none" />
      <span>{message}</span>
    </p>
  );
}
