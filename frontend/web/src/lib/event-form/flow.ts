import type { SubmissionOutcome } from "./outcome";
import type { FormReload } from "./requests";
import type { PublicEventForm } from "./types";

/** What the form does after a refused submission (FRM-015, FRM-030, FRM-040 to FRM-042). */
export type RefusalAction =
  /** Show each message key next to its field. */
  | { kind: "fields"; fields: Record<string, string> }
  /** Go back to the code screen with this message; the answers stay. */
  | { kind: "ask_code"; message: string }
  /** Load the form again and carry the answers over. */
  | { kind: "reload_form" }
  /** Show this message above the form; `retry` offers to send again. */
  | { kind: "message"; message: string; retry: boolean };

export function refusalAction(outcome: SubmissionOutcome): RefusalAction {
  switch (outcome.kind) {
    case "fields":
      return { kind: "fields", fields: outcome.fields };
    case "code_changed":
      return { kind: "ask_code", message: "eventForm.code.changed" };
    case "form_changed":
      return { kind: "reload_form" };
    default:
      return { kind: "message", message: `eventForm.refused.${outcome.kind}`, retry: outcome.kind === "network" };
  }
}

/** What the form does once loaded again after `form_changed` (FRM-030): show the new form, or say why not. */
export function afterReload(
  reload: FormReload,
): { kind: "form"; form: PublicEventForm; message: string } | Exclude<RefusalAction, { kind: "reload_form" }> {
  switch (reload.kind) {
    case "form":
      return { kind: "form", form: reload.form, message: "eventForm.refused.form_changed" };
    case "code_required":
      return { kind: "ask_code", message: "eventForm.code.changed" };
    case "closed":
      return { kind: "message", message: "eventForm.refused.closed", retry: false };
  }
}

/** Message key of a refused code on the code screen (FRM-002, FRM-042). */
export function unlockMessageKey(outcome: SubmissionOutcome): string {
  if (outcome.kind === "code_changed") return "eventForm.code.invalid";
  // The unlock route lists no field and has no form version: anything else is unexpected.
  if (outcome.kind === "fields" || outcome.kind === "form_changed") return "eventForm.refused.unknown";
  return `eventForm.refused.${outcome.kind}`;
}

/** The visitor's calendar day, `AAAA-MM-JJ`, the latest birth date it accepts (FRM-035). */
export function localDate(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
