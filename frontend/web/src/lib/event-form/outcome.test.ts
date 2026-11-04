import { ApiError } from "@cartouche/api-client";
import { describe, expect, test } from "vitest";
import { submissionOutcome } from "./outcome";

function refusal(status: number, code: string, fields: { field: string; code: string }[] = []): ApiError {
  return new ApiError({ status, code, message: code, requestId: "req-1", fields });
}

describe("submissionOutcome", () => {
  test("FRM-041 FRM-042 server refusals become outcomes", () => {
    expect(submissionOutcome(refusal(403, "invalid_access_code"))).toEqual({ kind: "code_changed" });
    expect(submissionOutcome(refusal(409, "form_changed"))).toEqual({ kind: "form_changed" });
    expect(submissionOutcome(refusal(409, "event_closed"))).toEqual({ kind: "closed" });
    expect(submissionOutcome(refusal(409, "device_limit_reached"))).toEqual({ kind: "device_limit" });
    expect(submissionOutcome(refusal(429, "rate_limited"))).toEqual({ kind: "rate_limited" });
    expect(submissionOutcome(refusal(410, "card_inactive"))).toEqual({ kind: "inactive" });
  });

  test("FRM-040 FRM-042 a failed fetch is a network outcome", () => {
    expect(submissionOutcome(new TypeError("Failed to fetch"))).toEqual({ kind: "network" });
  });

  test("FRM-015 FRM-036 invalid answers are listed by field with their error code", () => {
    const outcome = submissionOutcome(
      refusal(400, "validation_failed", [
        { field: "answers.email", code: "invalid_email" },
        { field: "answers.custom.0198d000-0000-7000-8000-0000000000a4", code: "invalid_number" },
        { field: "answers.custom.0198d000-0000-7000-8000-0000000000a5", code: "invalid_choice" },
        { field: "answers.birth_date", code: "invalid_date" },
        { field: "answers.custom.0198d000-0000-7000-8000-0000000000a6", code: "invalid_value" },
        { field: "consent", code: "required" },
        { field: "answers.email", code: "too_long" },
      ]),
    );
    expect(outcome).toEqual({
      kind: "fields",
      fields: {
        "answers.email": "invalid_email",
        "answers.custom.0198d000-0000-7000-8000-0000000000a4": "invalid_number",
        "answers.custom.0198d000-0000-7000-8000-0000000000a5": "invalid_choice",
        "answers.birth_date": "invalid_date",
        "answers.custom.0198d000-0000-7000-8000-0000000000a6": "invalid_value",
        consent: "required",
      },
    });
  });

  test("FRM-042 any other failure is unknown", () => {
    expect(submissionOutcome(refusal(400, "invalid_request"))).toEqual({ kind: "unknown" });
    expect(submissionOutcome(refusal(404, "not_found"))).toEqual({ kind: "unknown" });
    expect(submissionOutcome(refusal(500, "internal_error"))).toEqual({ kind: "unknown" });
    expect(submissionOutcome(new Error("boom"))).toEqual({ kind: "unknown" });
    expect(submissionOutcome("nope")).toEqual({ kind: "unknown" });
  });
});
