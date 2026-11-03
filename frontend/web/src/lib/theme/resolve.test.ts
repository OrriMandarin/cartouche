import { describe, expect, test } from "vitest";
import { THEME_PRESETS } from "./presets";
import { themeToCssVars } from "./css-vars";
import { resolveTheme } from "./resolve";

const craie = THEME_PRESETS.find((preset) => preset.id === "craie")!;

describe("resolveTheme", () => {
  test("TPL-019 unknown preset and font fall back to defaults", () => {
    const theme = resolveTheme({ preset: "clair", font: "inconnue" });
    expect(theme.presetId).toBe("craie");
    expect(theme.fontId).toBe("inter");
    expect(theme.accent).toBe(craie.accent);
  });

  test("TPL-010 the owner's settings override the preset, the rest stays the preset's", () => {
    const theme = resolveTheme({ preset: "encre", accent: "#ff0066" });
    expect(theme.accent).toBe("#ff0066");
    expect(theme.text).toBe("#f1f0ec");
    expect(theme.fontPair.id).toBe("inter");
  });

  test("TPL-021 TPL-022 the text on accent and the scheme follow the resolved colours", () => {
    expect(resolveTheme({ preset: "encre" })).toMatchObject({ onAccent: "#111111", colorScheme: "dark" });
    expect(resolveTheme({ preset: "craie" })).toMatchObject({ onAccent: "#FFFFFF", colorScheme: "light" });
    expect(resolveTheme({ preset: "craie", accent: "#ffff00" }).onAccent).toBe("#111111");
    expect(resolveTheme({ preset: "craie", text: "#ffffff", background: { kind: "solid", color: "#000000" } }).colorScheme).toBe("dark");
  });

  test("TPL-019 absent or malformed input resolves to the default preset", () => {
    for (const raw of [undefined, null, {}, "craie", 42, [], { preset: 3 }]) {
      expect(resolveTheme(raw).presetId).toBe("craie");
    }
  });

  test("TPL-019 an unknown font keeps the font of the preset", () => {
    const playfair = THEME_PRESETS.find((preset) => preset.font === "playfair")!;
    expect(resolveTheme({ preset: playfair.id, font: "inconnue" }).fontId).toBe("playfair");
    expect(resolveTheme({ preset: playfair.id, font: "fraunces" }).fontId).toBe("fraunces");
  });

  test("TPL-010 TPL-017 overrides apply, invalid ones are ignored", () => {
    const theme = resolveTheme({
      preset: "craie",
      accent: "#FF0000",
      text: "#00AA00",
      background: { kind: "gradient", from: "#000000", to: "#FFFFFF", angle: 45 },
      header_gradient: 80,
      button_shape: "square",
    });
    expect(theme.accent).toBe("#ff0000");
    expect(theme.text).toBe("#00aa00");
    expect(theme.background).toEqual({ kind: "gradient", from: "#000000", to: "#ffffff", angle: 45 });
    expect(theme.headerGradient).toBe(80);
    expect(theme.buttonShape).toBe("square");

    const invalid = resolveTheme({
      preset: "craie",
      accent: "url(x)",
      text: "#fff; background:url(x)",
      background: { kind: "gradient", from: "#000000", to: "red", angle: 90 },
      header_gradient: 150,
      button_shape: "hexagon",
    });
    expect(invalid.accent).toBe(craie.accent);
    expect(invalid.text).toBe(craie.text);
    expect(invalid.background).toEqual(craie.background);
    expect(invalid.headerGradient).toBe(craie.headerGradient);
    expect(invalid.buttonShape).toBe(craie.buttonShape);
  });

  test("TPL-017 out-of-grammar values are ignored one by one", () => {
    const base = resolveTheme({ preset: "craie" });
    const cases: Record<string, unknown>[] = [
      { accent: "#12345" },
      { accent: "#12345g" },
      { accent: "#1234567" },
      { accent: 12 },
      { header_gradient: -1 },
      { header_gradient: 50.5 },
      { header_gradient: "50" },
      { background: { kind: "image", color: "#000000" } },
      { background: { kind: "solid", color: "blue" } },
      { background: { kind: "gradient", from: "#000000", to: "#ffffff", angle: 361 } },
      { background: { kind: "gradient", from: "#000000", to: "#ffffff", angle: -1 } },
      { background: { kind: "gradient", from: "#000000", to: "#ffffff", angle: "90" } },
      { background: "url(x)" },
    ];
    for (const override of cases) {
      expect(resolveTheme({ preset: "craie", ...override }), JSON.stringify(override)).toEqual(base);
    }
  });

  test("TPL-017 boundary values are accepted", () => {
    const theme = resolveTheme({
      preset: "craie",
      header_gradient: 0,
      background: { kind: "gradient", from: "#000000", to: "#ffffff", angle: 360 },
    });
    expect(theme.headerGradient).toBe(0);
    expect(theme.background).toMatchObject({ kind: "gradient", angle: 360 });
    expect(resolveTheme({ preset: "craie", header_gradient: 100 }).headerGradient).toBe(100);
  });

  test("TPL-017 no css-injection payload reaches the style", () => {
    const style = themeToCssVars(
      resolveTheme({
        preset: "craie",
        accent: "url(https://evil.example/x)",
        text: "red; background:url(x)",
        font: "x;}body{display:none",
      }),
    );
    for (const value of Object.values(style)) expect(String(value)).not.toMatch(/url\(|evil|;|\{/);
  });
});
