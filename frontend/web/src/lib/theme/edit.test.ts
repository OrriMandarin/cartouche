import { describe, expect, test } from "vitest";
import { applyPresetChange, switchBackgroundKind } from "./edit";

describe("applyPresetChange", () => {
  test("TPL-009 TPL-010 a preset is a starting point: choosing one drops every override", () => {
    expect(applyPresetChange("encre")).toEqual({ preset: "encre" });
  });
});

describe("switchBackgroundKind", () => {
  test("TPL-010 solid to gradient starts and ends from what the owner sees", () => {
    // craie: pale background, blue accent.
    expect(switchBackgroundKind({ preset: "craie" }, "gradient")).toEqual({
      preset: "craie",
      background: { kind: "gradient", from: "#f7f6f2", to: "#2f55d4", angle: 135 },
    });
    expect(
      switchBackgroundKind({ preset: "craie", accent: "#ff0066", background: { kind: "solid", color: "#eeeeee" } }, "gradient")
        .background,
    ).toEqual({ kind: "gradient", from: "#eeeeee", to: "#ff0066", angle: 135 });
  });

  test("TPL-010 gradient to solid keeps the first color, other overrides stay", () => {
    const theme = {
      preset: "terracotta",
      accent: "#ff0066",
      background: { kind: "gradient" as const, from: "#010203", to: "#040506", angle: 90 },
    };
    expect(switchBackgroundKind(theme, "solid")).toEqual({
      preset: "terracotta",
      accent: "#ff0066",
      background: { kind: "solid", color: "#010203" },
    });
  });

  test("TPL-010 the preset's own gradient converts too, and the same kind is a no-op", () => {
    expect(switchBackgroundKind({ preset: "terracotta" }, "solid").background).toEqual({ kind: "solid", color: "#fbf0e4" });
    const theme = { preset: "craie" };
    expect(switchBackgroundKind(theme, "solid")).toBe(theme);
  });
});
