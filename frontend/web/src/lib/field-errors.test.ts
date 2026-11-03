import { describe, expect, test } from "vitest";
import { fieldErrorKey, fieldErrorKeys } from "./field-errors";

describe("field errors", () => {
  test("EDI-015 FRM-015 a code reads as its message key", () => {
    expect(fieldErrorKey("invalid_email")).toBe("fieldErrors.invalid_email");
  });

  test("EDI-015 FRM-015 the first error of each path is kept", () => {
    expect(
      fieldErrorKeys([
        { field: "answers.email", code: "required" },
        { field: "answers.email", code: "invalid_email" },
        { field: "consent", code: "required" },
      ]),
    ).toEqual({ "answers.email": "fieldErrors.required", consent: "fieldErrors.required" });
  });
});
