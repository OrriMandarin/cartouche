import { describe, expect, test } from "vitest";
import { checkLeadDraft, draftToSubmission, emptyLeadDraft, refreshDraft, type LeadDraft } from "./answers";
import {
  CHECKBOX_ID,
  CHOICE_ID,
  DATE_ID,
  LONG_ID,
  NUMBER_ID,
  TEXT_ID,
  publicEventForm,
} from "./form.fixture";
import type { PublicEventForm } from "./types";

const TODAY = "2027-03-15";
const DEVICE = "0198d000-0000-4000-8000-000000000042";

function filled(form: PublicEventForm, patch: (draft: LeadDraft) => void = () => {}): LeadDraft {
  const draft = emptyLeadDraft(form);
  draft.answers.first_name = "Éloïse";
  draft.answers.last_name = "D’Aubigné-Müller";
  draft.answers.email = "eloise@example.org";
  draft.consent = true;
  patch(draft);
  return draft;
}

function withFields(fields: PublicEventForm["standard_fields"], custom: PublicEventForm["custom_fields"] = []) {
  return publicEventForm({ standard_fields: fields, custom_fields: custom });
}

describe("emptyLeadDraft", () => {
  test("FRM-033 the country defaults to France and a box starts unchecked", () => {
    const draft = emptyLeadDraft(publicEventForm());
    expect(draft.answers).toEqual({
      first_name: "",
      last_name: "",
      birth_date: "",
      email: "",
      phone: "",
      address: { street: "", postal_code: "", city: "", country: "France" },
    });
    expect(draft.custom).toEqual({
      [TEXT_ID]: "",
      [LONG_ID]: "",
      [DATE_ID]: "",
      [NUMBER_ID]: "",
      [CHOICE_ID]: "",
      [CHECKBOX_ID]: false,
    });
    expect(draft.consent).toBe(false);
    expect(draft.fax).toBe("");
  });
});

describe("checkLeadDraft", () => {
  test("FRM-033 a required address needs every part and defaults to France", () => {
    const form = withFields([
      { field: "first_name", required: false },
      { field: "address", required: true },
    ]);
    const draft = emptyLeadDraft(form);
    draft.consent = true;
    expect(checkLeadDraft(form, draft, TODAY)).toEqual({
      "answers.address.street": "fieldErrors.required",
      "answers.address.postal_code": "fieldErrors.required",
      "answers.address.city": "fieldErrors.required",
    });
    draft.answers.address.country = "  ";
    expect(checkLeadDraft(form, draft, TODAY)).toHaveProperty("answers.address.country", "fieldErrors.required");
    draft.answers.address = { street: "1 rue de l’Église", postal_code: "75011", city: "Paris", country: "France" };
    expect(checkLeadDraft(form, draft, TODAY)).toEqual({});
  });

  test("FRM-034 a required field left empty or blank is refused, an optional one is not", () => {
    const form = publicEventForm();
    const draft = emptyLeadDraft(form);
    draft.answers.first_name = "   ";
    draft.consent = true;
    expect(checkLeadDraft(form, draft, TODAY)).toEqual({
      "answers.first_name": "fieldErrors.required",
      "answers.last_name": "fieldErrors.required",
      "answers.email": "fieldErrors.required",
    });
  });

  test("FRM-034 FRM-012 client checks mirror the server rules on lengths and email", () => {
    const form = publicEventForm();
    const draft = filled(form, (d) => {
      d.answers.first_name = "é".repeat(101);
      d.answers.last_name = "😀".repeat(100);
      d.answers.email = `${"a".repeat(250)}@b.fr`;
    });
    expect(checkLeadDraft(form, draft, TODAY)).toEqual({
      "answers.first_name": "fieldErrors.too_long",
      "answers.email": "fieldErrors.too_long",
    });
    for (const bad of ["alice", "alice@", "@example.org", "alice@example", "a@@example.org", "al ice@example.org", "a@b..fr"]) {
      const errors = checkLeadDraft(form, filled(form, (d) => (d.answers.email = bad)), TODAY);
      expect(errors, bad).toEqual({ "answers.email": "fieldErrors.invalid_email" });
    }
    expect(checkLeadDraft(form, filled(form, (d) => (d.answers.email = "éloïse@exemple.fr")), TODAY)).toEqual({});
  });

  test("FRM-034 custom text lengths follow the field kind", () => {
    const form = publicEventForm();
    const errors = checkLeadDraft(
      form,
      filled(form, (d) => {
        d.custom[TEXT_ID] = "x".repeat(501);
        d.custom[LONG_ID] = "x".repeat(5000);
      }),
      TODAY,
    );
    expect(errors).toEqual({ [`answers.custom.${TEXT_ID}`]: "fieldErrors.too_long" });
  });

  test("FRM-035 dates exist, stay in 1900..2100 and a birth date is not in the future", () => {
    const form = publicEventForm();
    const birth = (value: string) =>
      checkLeadDraft(form, filled(form, (d) => (d.answers.birth_date = value)), TODAY)["answers.birth_date"];
    expect(birth("1990-02-28")).toBeUndefined();
    expect(birth(TODAY)).toBeUndefined();
    for (const bad of ["2027-03-16", "1990-02-30", "1990-13-01", "1899-12-31", "15/03/1990", "1990-3-1", "٢٠٢٠-٠١-٠١"]) {
      expect(birth(bad), bad).toBe("fieldErrors.invalid_date");
    }
    const custom = (value: string) =>
      checkLeadDraft(form, filled(form, (d) => (d.custom[DATE_ID] = value)), TODAY)[`answers.custom.${DATE_ID}`];
    expect(custom("2100-12-31")).toBeUndefined();
    expect(custom("2101-01-01")).toBe("fieldErrors.invalid_date");
    expect(custom("2028-02-29")).toBeUndefined();
    expect(custom("2027-02-29")).toBe("fieldErrors.invalid_date");
    expect(custom("2099-01-01")).toBeUndefined();
  });

  test("FRM-036 numbers take a point or a comma, choices one of the options", () => {
    const form = publicEventForm();
    const number = (value: string) =>
      checkLeadDraft(form, filled(form, (d) => (d.custom[NUMBER_ID] = value)), TODAY)[`answers.custom.${NUMBER_ID}`];
    for (const ok of ["12", "12.5", "12,5", "-3", "+0,25", "007"]) expect(number(ok), ok).toBeUndefined();
    for (const bad of ["12,", ".5", "1.2.3", "1 000", "abc", "12e3", "--1", "1,2,3"]) {
      expect(number(bad), bad).toBe("fieldErrors.invalid_number");
    }
    const choice = (value: string) =>
      checkLeadDraft(form, filled(form, (d) => (d.custom[CHOICE_ID] = value)), TODAY)[`answers.custom.${CHOICE_ID}`];
    expect(choice("Premium")).toBeUndefined();
    expect(choice("")).toBeUndefined();
    expect(choice("Luxe")).toBe("fieldErrors.invalid_choice");
  });

  test("FRM-034 a required custom field and a required checkbox", () => {
    const form = withFields(
      [{ field: "first_name", required: false }],
      [
        { id: TEXT_ID, kind: "text", label: "Entreprise", required: true },
        { id: CHECKBOX_ID, kind: "checkbox", label: "Règlement", required: true },
      ],
    );
    const draft = { ...emptyLeadDraft(form), consent: true };
    expect(checkLeadDraft(form, draft, TODAY)).toEqual({
      [`answers.custom.${TEXT_ID}`]: "fieldErrors.required",
      [`answers.custom.${CHECKBOX_ID}`]: "fieldErrors.required",
    });
    draft.custom[CHECKBOX_ID] = true;
    draft.custom[TEXT_ID] = "Atelier ✨";
    expect(checkLeadDraft(form, draft, TODAY)).toEqual({});
  });

  test("FRM-037 an unchecked consent is refused", () => {
    const form = publicEventForm();
    expect(checkLeadDraft(form, filled(form, (d) => (d.consent = false)), TODAY)).toEqual({
      consent: "fieldErrors.required",
    });
  });

  test("FRM-034 answers to fields the form does not ask are not checked", () => {
    const form = withFields([{ field: "first_name", required: true }]);
    const draft = filled(form, (d) => {
      d.answers.email = "not an email";
      d.answers.birth_date = "nope";
    });
    expect(checkLeadDraft(form, draft, TODAY)).toEqual({});
  });
});

describe("draftToSubmission", () => {
  test("FRM-036 numbers accept a comma", () => {
    const form = publicEventForm();
    const body = draftToSubmission(form, filled(form, (d) => (d.custom[NUMBER_ID] = "12,5")), DEVICE, null);
    expect(body.answers.custom?.[NUMBER_ID]).toBe(12.5);
    const integer = draftToSubmission(form, filled(form, (d) => (d.custom[NUMBER_ID] = "-7")), DEVICE, null);
    expect(integer.answers.custom?.[NUMBER_ID]).toBe(-7);
  });

  test("FRM-036 a number the server must judge is sent as typed", () => {
    const form = publicEventForm();
    const body = draftToSubmission(form, filled(form, (d) => (d.custom[NUMBER_ID] = "12 abc")), DEVICE, null);
    expect(body.answers.custom?.[NUMBER_ID]).toBe("12 abc");
  });

  test("FRM-016 EVT-028 FRM-030 the body carries the device, the form version, the consent and the trap", () => {
    const form = publicEventForm();
    const body = draftToSubmission(
      form,
      filled(form, (d) => {
        d.answers.first_name = "  Éloïse ";
        d.answers.phone = "06 12 34 56 78";
        d.custom[TEXT_ID] = " Atelier ✨ ";
        d.custom[CHECKBOX_ID] = true;
        d.custom[CHOICE_ID] = "Premium";
        d.custom[DATE_ID] = "2027-05-01";
      }),
      DEVICE,
      "Château",
    );
    expect(body).toEqual({
      device_id: DEVICE,
      access_code: "Château",
      form_version: "00112233445566ff",
      fax: "",
      consent: true,
      answers: {
        first_name: "Éloïse",
        last_name: "D’Aubigné-Müller",
        email: "eloise@example.org",
        phone: "06 12 34 56 78",
        custom: {
          [TEXT_ID]: "Atelier ✨",
          [DATE_ID]: "2027-05-01",
          [CHOICE_ID]: "Premium",
          [CHECKBOX_ID]: true,
        },
      },
    });
  });

  test("EVT-011 without a code, the body has no access_code", () => {
    const form = publicEventForm();
    expect(draftToSubmission(form, filled(form), DEVICE, null)).not.toHaveProperty("access_code");
  });

  test("FRM-034 empty answers are left out and an unchecked box is false", () => {
    const form = publicEventForm();
    const body = draftToSubmission(form, filled(form), DEVICE, null);
    expect(body.answers).toEqual({
      first_name: "Éloïse",
      last_name: "D’Aubigné-Müller",
      email: "eloise@example.org",
      custom: { [CHECKBOX_ID]: false },
    });
  });

  test("FRM-018 FRM-033 an address is sent whole, and not at all when only the default country is there", () => {
    const form = publicEventForm();
    expect(draftToSubmission(form, filled(form), DEVICE, null).answers).not.toHaveProperty("address");
    const body = draftToSubmission(
      form,
      filled(form, (d) => (d.answers.address = { street: " 1 rue de l’Église ", postal_code: "75011", city: "", country: "France" })),
      DEVICE,
      null,
    );
    expect(body.answers.address).toEqual({ street: "1 rue de l’Église", postal_code: "75011", country: "France" });
  });

  test("FRM-017 answers to fields the form does not ask are never sent", () => {
    const form = withFields([{ field: "first_name", required: true }]);
    const body = draftToSubmission(
      form,
      filled(form, (d) => {
        d.answers.email = "stale@example.org";
        d.answers.address.street = "stale";
        d.custom["0198d000-0000-7000-8000-0000000000ff"] = "stale";
      }),
      DEVICE,
      null,
    );
    expect(body.answers).toEqual({ first_name: "Éloïse", custom: {} });
  });

  test("ABU-002 the trap field is passed through", () => {
    const form = publicEventForm();
    expect(draftToSubmission(form, filled(form, (d) => (d.fax = "robot")), DEVICE, null).fax).toBe("robot");
  });
});

describe("refreshDraft", () => {
  test("FRM-030 a refreshed form keeps the answers that still apply and unchecks consent", () => {
    const before = publicEventForm();
    const draft = filled(before, (d) => {
      d.answers.phone = "0612345678";
      d.answers.address = { street: "1 rue", postal_code: "75011", city: "Paris", country: "Belgique" };
      d.custom[TEXT_ID] = "Atelier";
      d.custom[NUMBER_ID] = "12,5";
      d.custom[CHOICE_ID] = "Premium";
      d.custom[CHECKBOX_ID] = true;
    });
    const after = publicEventForm({
      form_version: "ffffffffffffffff",
      standard_fields: [
        { field: "first_name", required: true },
        { field: "email", required: true },
        { field: "address", required: true },
      ],
      custom_fields: [
        { id: TEXT_ID, kind: "text", label: "Société", required: false },
        { id: NUMBER_ID, kind: "text", label: "Budget (texte)", required: false },
        { id: CHOICE_ID, kind: "single_choice", label: "Formule", required: false, options: ["Standard", "Luxe"] },
        { id: CHECKBOX_ID, kind: "checkbox", label: "Newsletter", required: false },
        { id: "0198d000-0000-7000-8000-0000000000b1", kind: "text", label: "Nouveau", required: false },
      ],
    });
    const refreshed = refreshDraft(draft, after);
    expect(refreshed.consent).toBe(false);
    expect(refreshed.answers).toEqual({
      first_name: "Éloïse",
      last_name: "",
      birth_date: "",
      email: "eloise@example.org",
      phone: "",
      address: { street: "1 rue", postal_code: "75011", city: "Paris", country: "Belgique" },
    });
    expect(refreshed.custom).toEqual({
      [TEXT_ID]: "Atelier",
      [NUMBER_ID]: "12,5",
      [CHOICE_ID]: "",
      [CHECKBOX_ID]: true,
      "0198d000-0000-7000-8000-0000000000b1": "",
    });
  });

  test("FRM-030 an answer of the wrong type for its field is dropped", () => {
    const form = publicEventForm();
    const draft = filled(form);
    draft.custom[CHECKBOX_ID] = "yes";
    draft.custom[TEXT_ID] = true;
    const refreshed = refreshDraft(draft, form);
    expect(refreshed.custom[CHECKBOX_ID]).toBe(false);
    expect(refreshed.custom[TEXT_ID]).toBe("");
  });
});
