import { describe, expect, test } from "vitest";
import { emptyLeadDraft } from "./answers";
import { afterReload, refusalAction, sentFirstName, unlockMessageKey, utcDate } from "./flow";
import { publicEventForm } from "./form.fixture";

describe("refusalAction", () => {
  test("FRM-015 invalid answers go next to their fields", () => {
    const fields = { "answers.email": "invalid_email" };
    expect(refusalAction({ kind: "fields", fields })).toEqual({ kind: "fields", fields });
  });

  test("FRM-041 a changed code asks for the code again", () => {
    expect(refusalAction({ kind: "code_changed" })).toEqual({ kind: "ask_code", message: "eventForm.code.changed" });
  });

  test("FRM-030 a changed form is reloaded", () => {
    expect(refusalAction({ kind: "form_changed" })).toEqual({ kind: "reload_form" });
  });

  test("FRM-040 a network error offers to send again", () => {
    expect(refusalAction({ kind: "network" })).toEqual({
      kind: "message",
      message: "eventForm.refused.network",
      retry: true,
    });
  });

  test("FRM-042 every other refusal has its own message", () => {
    for (const kind of ["closed", "device_limit", "rate_limited", "inactive", "unknown"] as const) {
      expect(refusalAction({ kind })).toEqual({ kind: "message", message: `eventForm.refused.${kind}`, retry: false });
    }
  });
});

describe("unlockMessageKey", () => {
  test("FRM-002 EVT-027 a wrong code says so", () => {
    expect(unlockMessageKey({ kind: "code_changed" })).toBe("eventForm.code.invalid");
  });

  test("FRM-042 other refusals of the code screen use the refusal messages", () => {
    expect(unlockMessageKey({ kind: "rate_limited" })).toBe("eventForm.refused.rate_limited");
    expect(unlockMessageKey({ kind: "closed" })).toBe("eventForm.refused.closed");
    expect(unlockMessageKey({ kind: "fields", fields: {} })).toBe("eventForm.refused.unknown");
  });
});

describe("utcDate", () => {
  test("FRM-035 today is the UTC calendar day, as on the server, whatever the visitor's time zone", () => {
    expect(utcDate(new Date("2027-03-05T23:30:00-05:00"))).toBe("2027-03-06");
    expect(utcDate(new Date("2027-03-06T00:30:00+02:00"))).toBe("2027-03-05");
    expect(utcDate(new Date("2027-12-31T23:59:59Z"))).toBe("2027-12-31");
  });
});

describe("afterReload", () => {
  test("FRM-030 a reloaded form replaces the old one, with its message", () => {
    const form = publicEventForm();
    expect(afterReload({ kind: "form", form })).toEqual({
      kind: "form",
      form,
      message: "eventForm.refused.form_changed",
    });
  });

  test("FRM-041 EVT-013 a code added meanwhile asks for it", () => {
    expect(afterReload({ kind: "code_required" })).toEqual({ kind: "ask_code", message: "eventForm.code.changed" });
  });

  test("FRM-042 a form closed meanwhile says so", () => {
    expect(afterReload({ kind: "closed" })).toEqual({
      kind: "message",
      message: "eventForm.refused.closed",
      retry: false,
    });
  });
});

describe("sentFirstName", () => {
  const draftOf = (firstName: string) => {
    const draft = emptyLeadDraft(publicEventForm());
    draft.answers.first_name = firstName;
    return draft;
  };

  test("FRM-047 the confirmation thanks the first name the prospect sent, trimmed", () => {
    expect(sentFirstName(publicEventForm(), draftOf("  Inès "))).toBe("Inès");
  });

  test("FRM-047 without a first name the confirmation stays neutral", () => {
    expect(sentFirstName(publicEventForm(), draftOf("  "))).toBe("");
    const withoutFirstName = publicEventForm({ standard_fields: [{ field: "email", required: true }] });
    expect(sentFirstName(withoutFirstName, draftOf("Inès"))).toBe("");
  });
});
