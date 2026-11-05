import { describe, expect, test } from "vitest";
import { contactLabel } from "./contact-label";

describe("contactLabel", () => {
  test("FRM-047 de becomes d’ before a vowel", () => {
    expect(contactLabel("Camille")).toEqual({ key: "saveContactOf", values: { firstName: "Camille" } });
    expect(contactLabel("Alice")).toEqual({ key: "saveContactOfElided", values: { firstName: "Alice" } });
    expect(contactLabel("Éloïse")).toEqual({ key: "saveContactOfElided", values: { firstName: "Éloïse" } });
    expect(contactLabel("Yann")).toEqual({ key: "saveContactOfElided", values: { firstName: "Yann" } });
    expect(contactLabel("Hugo")).toEqual({ key: "saveContactOf", values: { firstName: "Hugo" } });
  });

  test("FRM-047 a card without first name keeps the neutral label", () => {
    expect(contactLabel("")).toEqual({ key: "saveContact" });
    expect(contactLabel("  ")).toEqual({ key: "saveContact" });
  });
});
