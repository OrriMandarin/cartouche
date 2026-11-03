import { describe, expect, test } from "vitest";
import { parseSettings, type SettingsSchema } from "./settings-schema";

const schema: SettingsSchema = {
  fields: [
    {
      kind: "select",
      key: "layout",
      labelKey: "x.layout",
      options: [
        { value: "list", labelKey: "x.list" },
        { value: "icons", labelKey: "x.icons" },
      ],
      default: "list",
    },
    { kind: "boolean", key: "animate", labelKey: "x.animate", default: true },
    { kind: "range", key: "size", labelKey: "x.size", min: 10, max: 50, step: 5, default: 20 },
    { kind: "color", key: "tint", labelKey: "x.tint", default: "#112233" },
  ],
};

const defaults = { layout: "list", animate: true, size: 20, tint: "#112233" };

describe("parseSettings", () => {
  test("TPL-016 invalid or missing settings fall back to defaults", () => {
    expect(
      parseSettings(schema, {
        layout: "grille",
        animate: "oui",
        size: 999,
        tint: "url(x)",
        unknown: "dropped",
      }),
    ).toEqual(defaults);
    expect(parseSettings(schema, {})).toEqual(defaults);
    for (const raw of [undefined, null, "texte", 42, [], [1]]) {
      expect(parseSettings(schema, raw)).toEqual(defaults);
    }
  });

  test("TPL-016 an unknown key is removed", () => {
    expect(Object.keys(parseSettings(schema, { layout: "icons", other: 1, __proto__: { x: 1 } }))).toEqual([
      "layout",
      "animate",
      "size",
      "tint",
    ]);
  });

  test("TPL-016 non-finite and out-of-bounds numbers take the default", () => {
    for (const size of [Number.NaN, Number.POSITIVE_INFINITY, 9, 51, "30", null]) {
      expect(parseSettings(schema, { size }).size).toBe(20);
    }
  });

  test("TPL-004 parseSettings keeps valid values", () => {
    expect(
      parseSettings(schema, { layout: "icons", animate: false, size: 35, tint: "#AABBCC" }),
    ).toEqual({ layout: "icons", animate: false, size: 35, tint: "#aabbcc" });
    expect(parseSettings(schema, { size: 10 }).size).toBe(10);
    expect(parseSettings(schema, { size: 50 }).size).toBe(50);
  });
});
