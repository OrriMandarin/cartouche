import { describe, expect, test } from "vitest";
import themesJson from "./themes.json";
import {
  failedChecks,
  formatRatio,
  isDarkTheme,
  measureContrast,
  onAccentFor,
  readableFix,
  type ContrastCheck,
  type ThemeColors,
} from "./contrast";
import { mixOklab, parseHex, toHex } from "./color";

const solid = (text: string, color: string, accent = "#2F55D4"): ThemeColors => ({
  accent,
  text,
  background: { kind: "solid", color },
});

type JsonTheme = (typeof themesJson.themes)[number];

function colorsOf(theme: JsonTheme): ThemeColors {
  const { background } = theme as JsonTheme & { background: { type: string; color?: string; from?: string; to?: string; angle?: number } };
  return {
    accent: theme.accent,
    text: theme.text,
    background:
      background.type === "solid"
        ? { kind: "solid", color: background.color! }
        : { kind: "gradient", from: background.from!, to: background.to!, angle: background.angle! },
  };
}

describe("contrast", () => {
  test("TPL-018 the eight ready-made themes measure as the design's contrastChecks table", () => {
    const table = themesJson.contrastChecks as unknown as Record<string, Record<ContrastCheck, number>>;
    for (const theme of themesJson.themes) {
      const measured = measureContrast(colorsOf(theme));
      for (const check of ["text", "mutedOnHover", "onAccent", "accentVsBg"] as const) {
        expect(Math.abs(measured[check] - table[theme.id]![check]), `${theme.id} ${check}`).toBeLessThanOrEqual(0.1);
      }
    }
  });

  test("TPL-018 #767676 on white passes and #777777 fails", () => {
    expect(measureContrast(solid("#767676", "#ffffff")).text).toBeCloseTo(4.54, 2);
    expect(measureContrast(solid("#777777", "#ffffff")).text).toBeCloseTo(4.48, 2);
    expect(failedChecks(solid("#767676", "#ffffff"))).not.toContain("text");
    expect(failedChecks(solid("#777777", "#ffffff"))).toContain("text");
  });

  test("TPL-018 a gradient fails when one of its two colours fails", () => {
    const gradient: ThemeColors = {
      accent: "#2F55D4",
      text: "#444444",
      background: { kind: "gradient", from: "#ffffff", to: "#888888", angle: 90 },
    };
    expect(failedChecks(gradient)).toContain("text");
  });

  test("TPL-018 the muted text is mixed with the first background colour", () => {
    const mixed = parseHex(toHex(mixOklab(parseHex("#1B1A17"), parseHex("#F7F6F2"), 0.78)));
    const expected = parseHex("#444340");
    mixed.forEach((channel, i) => expect(Math.abs(channel - expected[i]!) * 255).toBeLessThanOrEqual(1));
  });

  test("TPL-021 white on a blue accent, near-black on a lime one", () => {
    expect(onAccentFor("#2F55D4")).toBe("#FFFFFF");
    expect(onAccentFor("#C8F04D")).toBe("#111111");
  });

  test("TPL-022 a theme is dark when its text is lighter than its background", () => {
    const byId = (id: string) => themesJson.themes.find((theme) => theme.id === id)!;
    const dark = (id: string) => isDarkTheme(colorsOf(byId(id)));
    expect(dark("encre")).toBe(true);
    expect(dark("minuit")).toBe(true);
    expect(dark("craie")).toBe(false);
  });

  test("TPL-024 the fix is the preset value, then #111111, then #FFFFFF, else none", () => {
    const terracotta = themesJson.themes.find((theme) => theme.id === "terracotta")!;
    const colors = { ...colorsOf(terracotta), text: "#b89580" };
    expect(failedChecks(colors)).toContain("text");
    expect(readableFix(colors, "text", terracotta.text)).toBe(terracotta.text.toLowerCase());
    expect(readableFix(solid("#000000", "#777777"), "text", "#777777")).toBeNull();
  });

  test("TPL-013 ratios are written with one decimal and a comma", () => {
    expect(formatRatio(2.04)).toBe("2,0");
    expect(formatRatio(11.26)).toBe("11,2");
  });
});
