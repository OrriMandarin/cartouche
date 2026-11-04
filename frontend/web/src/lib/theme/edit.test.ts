import { describe, expect, test } from "vitest";
import { applyPresetChange, contrastReport, switchBackgroundKind } from "./edit";

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

describe("contrastReport", () => {
  // terracotta (accent #b3441e, text #3b2117) with a pale brown text
  const unreadable = { preset: "terracotta", text: "#b89580" };

  test("TPL-013 TPL-018 a failed text check carries its measured and required ratios", () => {
    const report = contrastReport(unreadable);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({ setting: "text", check: "text", minimum: 4.5 });
    expect(Math.floor(report.issues[0]!.ratio * 10) / 10).toBe(2.0);
  });

  test("TPL-024 the fix is the preset's own value, as lowercase hex", () => {
    expect(contrastReport(unreadable).issues[0]!.fix).toBe("#3b2117");
  });

  test("TPL-013 one issue per setting: the first failed check of the text, of the accent", () => {
    const report = contrastReport({ preset: "craie", text: "#f7f6f2", accent: "#f7f6f2" });
    expect(report.issues.map((issue) => issue.setting)).toEqual(["text", "accent"]);
  });

  test("TPL-024 no fix when none of the three colours makes every check pass", () => {
    // The accent is unreadable too, so replacing the text alone cannot pass the four checks.
    const report = contrastReport({ preset: "craie", text: "#f7f6f2", accent: "#f7f6f2" });
    expect(report.issues.find((issue) => issue.setting === "text")!.fix).toBeNull();
  });

  test("EDI-030 a readable theme reports the ratios of the text and of the buttons", () => {
    const report = contrastReport({ preset: "craie" });
    expect(report.issues).toEqual([]);
    expect(report.textRatio).toBeGreaterThan(4.5);
    expect(report.buttonRatio).toBeGreaterThan(4.5);
  });
});
