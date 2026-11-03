import { ApiError } from "@cartouche/api-client";
import { fieldErrorKey } from "./field-error";

/** What a failed submission means for the form (FRM-015, FRM-040 to FRM-042). */
export type SubmissionOutcome =
  /** Invalid answers: message keys by field path (`answers.email`, `answers.custom.<id>`, `consent`). */
  | { kind: "fields"; fields: Record<string, string> }
  /** The access code changed since it was typed: ask for it again, keep the answers (FRM-041). */
  | { kind: "code_changed" }
  /** The form changed since it was loaded: reload it, keep what still applies (FRM-030). */
  | { kind: "form_changed" }
  | { kind: "closed" }
  | { kind: "device_limit" }
  | { kind: "rate_limited" }
  | { kind: "inactive" }
  /** The request did not reach the server: show a message and allow sending again (FRM-040). */
  | { kind: "network" }
  | { kind: "unknown" };

const BY_CODE: Record<string, SubmissionOutcome> = {
  invalid_access_code: { kind: "code_changed" },
  form_changed: { kind: "form_changed" },
  event_closed: { kind: "closed" },
  device_limit_reached: { kind: "device_limit" },
  rate_limited: { kind: "rate_limited" },
  card_inactive: { kind: "inactive" },
};

/** Reads the error thrown by the submission request. */
export function submissionOutcome(error: unknown): SubmissionOutcome {
  if (error instanceof TypeError) return { kind: "network" };
  if (!(error instanceof ApiError)) return { kind: "unknown" };
  if (error.code === "validation_failed" && error.fields.length > 0) {
    const fields: Record<string, string> = {};
    for (const { field, code } of error.fields) {
      if (!Object.hasOwn(fields, field)) fields[field] = fieldErrorKey(code);
    }
    return { kind: "fields", fields };
  }
  return (Object.hasOwn(BY_CODE, error.code) ? BY_CODE[error.code] : undefined) ?? { kind: "unknown" };
}
