import { describe, expect, test } from "vitest";
import { CUSTOM_FIELD_KINDS } from "./fields";
import fr from "../../../messages/fr.json";

describe("custom field kinds", () => {
  test("FRM-021 the editor offers the Date et heure type after Date", () => {
    expect(CUSTOM_FIELD_KINDS).toContain("datetime");
    expect(CUSTOM_FIELD_KINDS.indexOf("datetime")).toBe(CUSTOM_FIELD_KINDS.indexOf("date") + 1);
  });

  test("FRM-021 every kind has its label in the messages", () => {
    const kinds = fr.events.editor.custom.kinds as Record<string, string>;
    for (const kind of CUSTOM_FIELD_KINDS) expect(kinds[kind], kind).toBeTruthy();
    expect(kinds.datetime).toBe("Date et heure");
  });
});
