import { afterEach, describe, expect, test, vi } from "vitest";
import { emptyLeadDraft } from "./answers";
import { publicEventForm } from "./form.fixture";
import { clearDraft, loadDraft, saveDraft } from "./persist";

const EVENT = "0198d000-0000-7000-8000-000000000001";

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("draft persistence", () => {
  const draft = { ...emptyLeadDraft(publicEventForm()), consent: true };
  draft.answers.first_name = "Éloïse";

  test("FRM-040 the draft survives a reload and is cleared after success", () => {
    expect(loadDraft(EVENT)).toBeNull();
    saveDraft(EVENT, draft);
    expect(window.sessionStorage.getItem(`cartouche.lead.${EVENT}`)).not.toBeNull();
    expect(loadDraft(EVENT)).toEqual(draft);
    clearDraft(EVENT);
    expect(loadDraft(EVENT)).toBeNull();
  });

  test("FRM-040 each event has its own draft", () => {
    saveDraft(EVENT, draft);
    expect(loadDraft("another-event")).toBeNull();
  });

  test("FRM-040 an unreadable or foreign value is no draft", () => {
    const key = `cartouche.lead.${EVENT}`;
    window.sessionStorage.setItem(key, "{not json");
    expect(loadDraft(EVENT)).toBeNull();
    window.sessionStorage.setItem(key, JSON.stringify({ answers: 3 }));
    expect(loadDraft(EVENT)).toBeNull();
    window.sessionStorage.setItem(key, JSON.stringify({ ...draft, custom: { x: 12 } }));
    expect(loadDraft(EVENT)).toBeNull();
  });

  test("FRM-040 storage failures never throw", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => saveDraft(EVENT, draft)).not.toThrow();
    expect(loadDraft(EVENT)).toBeNull();
    expect(() => clearDraft(EVENT)).not.toThrow();
  });
});
