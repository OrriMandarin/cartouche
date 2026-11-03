import { describe, expect, test } from "vitest";
import { contrastRatio, hasContrastWarning } from "./contrast";
import { resolveTheme } from "./resolve";

describe("contrast", () => {
  test("TPL-018 contrast ratio matches WCAG", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);

    const grey777 = resolveTheme({ preset: "clair", text: "#777777", background: { kind: "solid", color: "#ffffff" } });
    expect(hasContrastWarning(grey777)).toBe(true);
    const grey767 = resolveTheme({ preset: "clair", text: "#767676", background: { kind: "solid", color: "#ffffff" } });
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(hasContrastWarning(grey767)).toBe(false);
  });

  test("TPL-018 gradient uses the worst stop", () => {
    const theme = resolveTheme({
      preset: "clair",
      text: "#ffffff",
      background: { kind: "gradient", from: "#000000", to: "#ffffff", angle: 90 },
    });
    expect(hasContrastWarning(theme)).toBe(true);
    const readable = resolveTheme({
      preset: "clair",
      text: "#ffffff",
      background: { kind: "gradient", from: "#000000", to: "#222222", angle: 90 },
    });
    expect(hasContrastWarning(readable)).toBe(false);
  });
});
