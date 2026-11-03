import { ApiError } from "@cartouche/api-client";
import { describe, expect, test } from "vitest";
import {
  type CustomFieldDraft,
  type EventDraft,
  addCustomField,
  addOption,
  clearErrors,
  draftFromEvent,
  draftToBody,
  enableEnd,
  eventFieldErrors,
  isEventDraftDirty,
  moveCustomField,
  newEventDraft,
  removeCustomField,
  removeOption,
  setOption,
  updateCustomField,
} from "./draft";
import { eventView } from "./event-view.fixture";

const PARIS = "Europe/Paris";
const ID_A = "0198d000-0000-7000-8000-00000000000a";
const ID_B = "0198d000-0000-7000-8000-00000000000b";

const fullEvent = eventView({
  title: "Salon de l’Artisanat ✨",
  description: "Rencontrez Éloïse D’Aubigné-Müller.",
  starts_at: "2027-04-02T08:00:00Z",
  ends_at: "2027-04-02T16:30:00Z",
  access_code: "Château",
  device_limit: 3,
  standard_fields: {
    first_name: "required",
    last_name: "optional",
    birth_date: "optional",
    email: "required",
    phone: "off",
    address: "required",
  },
  custom_fields: [
    { id: ID_A, label: "Zoé Lefèvre ✨", kind: "text", required: true, help: "Comme sur la carte" },
    { id: ID_B, label: "Atelier", kind: "single_choice", required: false, options: ["Poterie", "Tissage"] },
  ],
  consent_text: "Mon propre texte de consentement.",
});

function fieldAt(draft: EventDraft, index: number): CustomFieldDraft {
  const field = draft.customFields[index];
  if (!field) throw new Error(`no custom field at ${index}`);
  return field;
}

describe("event draft", () => {
  test("EDI-019 draft round trip", () => {
    const draft = draftFromEvent(fullEvent, PARIS);
    expect(draft.startsAt).toBe("2027-04-02T10:00");
    expect(draft.endsAt).toBe("2027-04-02T18:30");
    expect(draft.deviceLimit).toBe("3");
    expect(draft.consentMode).toBe("custom");
    expect(draftToBody(draft, PARIS)).toEqual({
      title: "Salon de l’Artisanat ✨",
      description: "Rencontrez Éloïse D’Aubigné-Müller.",
      starts_at: "2027-04-02T08:00:00.000Z",
      ends_at: "2027-04-02T16:30:00.000Z",
      access_code: "Château",
      device_limit: 3,
      standard_fields: fullEvent.standard_fields,
      custom_fields: [
        { id: ID_A, label: "Zoé Lefèvre ✨", kind: "text", required: true, help: "Comme sur la carte", options: [] },
        { id: ID_B, label: "Atelier", kind: "single_choice", required: false, help: null, options: ["Poterie", "Tissage"] },
      ],
      consent_text: "Mon propre texte de consentement.",
    });
  });

  test("EDI-019 an event without optional parts gives nulls and the default consent", () => {
    const draft = draftFromEvent(eventView(), PARIS);
    expect(draft.description).toBe("");
    expect(draft.endsAt).toBe("");
    expect(draft.accessCode).toBe("");
    expect(draft.consentMode).toBe("default");
    expect(draftToBody(draft, PARIS)).toMatchObject({
      description: null,
      ends_at: null,
      access_code: null,
      consent_text: null,
    });
  });

  test("EVT-007 EVT-022 the stored instants are shown and sent back in the zone given", () => {
    const draft = draftFromEvent(eventView({ starts_at: "2027-03-15T10:00:00Z" }), "America/New_York");
    expect(draft.startsAt).toBe("2027-03-15T06:00");
    expect(draftToBody(draft, "America/New_York").starts_at).toBe("2027-03-15T10:00:00.000Z");
  });

  test("EVT-014 FRM-019 new event defaults", () => {
    // 2027-03-15 09:20 UTC is 10:20 in Paris: the next full hour is 11:00.
    const draft = newEventDraft(PARIS, new Date("2027-03-15T09:20:00Z"));
    expect(draft.deviceLimit).toBe("1");
    expect(draft.startsAt).toBe("2027-03-15T11:00");
    expect(draft.endsAt).toBe("");
    expect(draft.title).toBe("");
    expect(draft.standardFields).toEqual({
      first_name: "required",
      last_name: "required",
      birth_date: "off",
      email: "required",
      phone: "optional",
      address: "off",
    });
    expect(draft.customFields).toEqual([]);
    expect(draft.consentMode).toBe("default");
    expect(draft.consentText).toBe("");
  });

  test("EVT-007 the next full hour is read in the user's zone, half-hour offsets included", () => {
    expect(newEventDraft("Asia/Kolkata", new Date("2027-03-15T09:20:00Z")).startsAt).toBe("2027-03-15T15:00");
    expect(newEventDraft(PARIS, new Date("2027-03-15T10:00:00Z")).startsAt).toBe("2027-03-15T12:00");
    expect(newEventDraft(PARIS, new Date("2027-03-15T22:59:59Z")).startsAt).toBe("2027-03-16T00:00");
  });

  test("EVT-014 EDI-019 a blank draft is sent with a missing start and a device limit the server refuses", () => {
    const draft = { ...newEventDraft(PARIS, new Date("2027-03-15T09:20:00Z")), startsAt: "", deviceLimit: " " };
    const body = draftToBody(draft, PARIS);
    expect(body.starts_at).toBeNull();
    expect(body.device_limit).toBe(0);
    expect(draftToBody({ ...draft, deviceLimit: "12" }, PARIS).device_limit).toBe(12);
    expect(draftToBody({ ...draft, deviceLimit: "1.5" }, PARIS).device_limit).toBe(0);
  });

  test("FRM-020 FRM-032 custom fields keep their id when moved", () => {
    let draft = newEventDraft(PARIS, new Date("2027-03-15T09:20:00Z"));
    draft = addCustomField(draft, "text");
    draft = addCustomField(draft, "single_choice");
    draft = addCustomField(draft, "checkbox");
    const [a, b, c] = [fieldAt(draft, 0), fieldAt(draft, 1), fieldAt(draft, 2)];
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect([a.kind, b.kind, c.kind]).toEqual(["text", "single_choice", "checkbox"]);
    expect(a).toMatchObject({ label: "", required: false, help: "", options: [] });

    draft = moveCustomField(draft, 2, -2);
    expect(draft.customFields.map((f) => f.id)).toEqual([c.id, a.id, b.id]);
    draft = removeCustomField(draft, 1);
    expect(draft.customFields.map((f) => f.id)).toEqual([c.id, b.id]);
  });

  test("FRM-020 a move past either end changes nothing", () => {
    let draft = newEventDraft(PARIS, new Date("2027-03-15T09:20:00Z"));
    draft = addCustomField(addCustomField(draft, "text"), "date");
    expect(moveCustomField(draft, 0, -1)).toEqual(draft);
    expect(moveCustomField(draft, 1, 1)).toEqual(draft);
    expect(moveCustomField(draft, 5, -1)).toEqual(draft);
  });

  test("FRM-021 only a single choice field sends options", () => {
    let draft = newEventDraft(PARIS, new Date("2027-03-15T09:20:00Z"));
    draft = addCustomField(draft, "single_choice");
    draft = {
      ...draft,
      customFields: [{ ...fieldAt(draft, 0), label: "Atelier", options: ["Poterie", "Tissage"] }],
    };
    expect(draftToBody(draft, PARIS).custom_fields[0]?.options).toEqual(["Poterie", "Tissage"]);
    // The kind changes: the options typed before are not kept.
    draft = { ...draft, customFields: [{ ...fieldAt(draft, 0), kind: "text" }] };
    expect(draftToBody(draft, PARIS).custom_fields[0]?.options).toEqual([]);
  });

  test("FRM-028 a blank custom consent goes back to the default", () => {
    const base = newEventDraft(PARIS, new Date("2027-03-15T09:20:00Z"));
    expect(draftToBody({ ...base, consentMode: "custom", consentText: "  " }, PARIS).consent_text).toBeNull();
    expect(draftToBody({ ...base, consentMode: "custom", consentText: "Mon texte" }, PARIS).consent_text).toBe("Mon texte");
    // A text typed before going back to the default is not sent.
    expect(draftToBody({ ...base, consentMode: "default", consentText: "Mon texte" }, PARIS).consent_text).toBeNull();
  });

  test("FRM-028 a stored blank consent opens as the default", () => {
    expect(draftFromEvent(eventView({ consent_text: "" }), PARIS).consentMode).toBe("default");
  });
});

describe("custom field editing", () => {
  const now = new Date("2027-03-15T09:20:00Z");

  test("FRM-021 a single choice field starts with two empty options, other kinds with none", () => {
    const draft = addCustomField(addCustomField(newEventDraft(PARIS, now), "single_choice"), "text");
    expect(fieldAt(draft, 0).options).toEqual(["", ""]);
    expect(fieldAt(draft, 1).options).toEqual([]);
  });

  test("FRM-020 a field is edited in place, its id and kind kept", () => {
    let draft = addCustomField(addCustomField(newEventDraft(PARIS, now), "text"), "checkbox");
    const [a, b] = [fieldAt(draft, 0), fieldAt(draft, 1)];
    draft = updateCustomField(draft, 1, { label: "Newsletter", required: true, help: "Une fois par mois" });
    expect(fieldAt(draft, 0)).toEqual(a);
    expect(fieldAt(draft, 1)).toEqual({ ...b, label: "Newsletter", required: true, help: "Une fois par mois" });
  });

  test("FRM-021 options are added, typed and removed", () => {
    let draft = addCustomField(newEventDraft(PARIS, now), "single_choice");
    draft = setOption(draft, 0, 0, "< 5 000 €");
    draft = setOption(draft, 0, 1, "> 5 000 €");
    draft = addOption(draft, 0);
    expect(fieldAt(draft, 0).options).toEqual(["< 5 000 €", "> 5 000 €", ""]);
    draft = removeOption(draft, 0, 1);
    expect(fieldAt(draft, 0).options).toEqual(["< 5 000 €", ""]);
  });

  test("FRM-021 FRM-032 no more than 20 options", () => {
    let draft = addCustomField(newEventDraft(PARIS, now), "single_choice");
    for (let i = 0; i < 30; i += 1) draft = addOption(draft, 0);
    expect(fieldAt(draft, 0).options).toHaveLength(20);
  });

  test("EVT-017 EDI-019 switching an open end on gives an end one hour after the start", () => {
    const draft = { ...newEventDraft(PARIS, now), startsAt: "2027-03-15T23:30" };
    expect(enableEnd(draft, PARIS).endsAt).toBe("2027-03-16T00:30");
    // An end already typed is kept.
    expect(enableEnd({ ...draft, endsAt: "2027-03-16T09:00" }, PARIS).endsAt).toBe("2027-03-16T09:00");
    // Without a start there is nothing to add an hour to.
    expect(enableEnd({ ...draft, startsAt: "" }, PARIS).endsAt).toBe("");
  });
});

describe("clearErrors", () => {
  const errors = {
    title: "fieldErrors.required",
    "custom_fields[1].label": "fieldErrors.required",
    "custom_fields[1].options": "fieldErrors.too_few_options",
    "custom_fields[1].options[0]": "fieldErrors.required",
    "custom_fields[10].label": "fieldErrors.required",
    custom_fields: "fieldErrors.too_many_fields",
  };

  test("EDI-015 a corrected field loses its message, and the ones below it", () => {
    expect(clearErrors(errors, ["title"])).not.toHaveProperty("title");
    expect(Object.keys(clearErrors(errors, ["custom_fields[1].options"]))).toEqual([
      "title",
      "custom_fields[1].label",
      "custom_fields[10].label",
      "custom_fields",
    ]);
    // `custom_fields[1]` is not `custom_fields[10]`.
    expect(clearErrors(errors, ["custom_fields[1]"])).toHaveProperty(["custom_fields[10].label"]);
    expect(clearErrors(errors, ["custom_fields"])).toEqual({ title: "fieldErrors.required" });
  });

  test("EDI-015 nothing to clear returns the same object", () => {
    expect(clearErrors(errors, ["description"])).toBe(errors);
  });
});

describe("eventFieldErrors", () => {
  function validationError(fields: { field: string; code: string }[]) {
    return new ApiError({ status: 400, code: "validation_failed", message: "x", requestId: "r", fields });
  }

  test("EDI-019 EDI-015 field errors map to event paths", () => {
    expect(
      eventFieldErrors(
        validationError([
          { field: "custom_fields[0].options[1]", code: "duplicate_option" },
          { field: "custom_fields[1].label", code: "required" },
          { field: "starts_at", code: "required" },
          { field: "device_limit", code: "out_of_range" },
          { field: "ends_at", code: "end_before_start" },
          { field: "ends_at", code: "invalid_value" },
        ]),
      ),
    ).toEqual({
      "custom_fields[0].options[1]": "fieldErrors.duplicate_option",
      "custom_fields[1].label": "fieldErrors.required",
      starts_at: "fieldErrors.required",
      device_limit: "fieldErrors.out_of_range",
      ends_at: "fieldErrors.end_before_start",
    });
  });

  test("EDI-015 a failure that is not a validation error has no field errors", () => {
    expect(eventFieldErrors(new Error("boom"))).toEqual({});
    expect(eventFieldErrors(undefined)).toEqual({});
  });
});

describe("isEventDraftDirty", () => {
  test("EDI-021 equal event drafts are clean, any edit is dirty, undoing is clean", () => {
    const saved = draftFromEvent(fullEvent, PARIS);
    expect(isEventDraftDirty(saved, draftFromEvent(fullEvent, PARIS), PARIS)).toBe(false);

    const edited = { ...saved, title: "Salon de l’Artisanat 2028 ✨" };
    expect(isEventDraftDirty(saved, edited, PARIS)).toBe(true);
    expect(isEventDraftDirty(saved, { ...edited, title: saved.title }, PARIS)).toBe(false);

    const moved = { ...saved, startsAt: "2027-04-02T11:00" };
    expect(isEventDraftDirty(saved, moved, PARIS)).toBe(true);
    const renamedField = addCustomField(saved, "text");
    expect(isEventDraftDirty(saved, renamedField, PARIS)).toBe(true);
    expect(isEventDraftDirty(saved, removeCustomField(renamedField, saved.customFields.length), PARIS)).toBe(false);
  });

  test("EDI-021 what the server reads the same way is no change", () => {
    const saved = draftFromEvent(fullEvent, PARIS);
    // An empty text is an absent one, and the default consent text is stored as no text.
    expect(isEventDraftDirty({ ...saved, description: "" }, { ...saved, description: "  " }, PARIS)).toBe(false);
    expect(
      isEventDraftDirty(
        { ...saved, consentMode: "default", consentText: "" },
        { ...saved, consentMode: "default", consentText: "Texte abandonné" },
        PARIS,
      ),
    ).toBe(false);
  });
});
