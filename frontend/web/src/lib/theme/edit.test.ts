import { describe, expect, test } from "vitest";
import { applyPresetChange, switchBackgroundKind } from "./edit";

describe("applyPresetChange", () => {
  test("TPL-009 TPL-010 a preset is a starting point: choosing one drops every override", () => {
    expect(applyPresetChange("sombre")).toEqual({ preset: "sombre" });
  });
});

describe("switchBackgroundKind", () => {
  test("TPL-010 solid to gradient starts and ends from what the owner sees", () => {
    // clair: white background, blue accent.
    expect(switchBackgroundKind({ preset: "clair" }, "gradient")).toEqual({
      preset: "clair",
      background: { kind: "gradient", from: "#ffffff", to: "#2563eb", angle: 135 },
    });
    expect(
      switchBackgroundKind({ preset: "clair", accent: "#ff0066", background: { kind: "solid", color: "#eeeeee" } }, "gradient")
        .background,
    ).toEqual({ kind: "gradient", from: "#eeeeee", to: "#ff0066", angle: 135 });
  });

  test("TPL-010 gradient to solid keeps the first color, other overrides stay", () => {
    const theme = {
      preset: "ocean",
      accent: "#ff0066",
      background: { kind: "gradient" as const, from: "#010203", to: "#040506", angle: 90 },
    };
    expect(switchBackgroundKind(theme, "solid")).toEqual({
      preset: "ocean",
      accent: "#ff0066",
      background: { kind: "solid", color: "#010203" },
    });
  });

  test("TPL-010 the preset's own gradient converts too, and the same kind is a no-op", () => {
    expect(switchBackgroundKind({ preset: "ocean" }, "solid").background).toEqual({ kind: "solid", color: "#0c4a6e" });
    const theme = { preset: "clair" };
    expect(switchBackgroundKind(theme, "solid")).toBe(theme);
  });
});
