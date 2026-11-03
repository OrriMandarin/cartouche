import { describe, expect, test } from "vitest";
import { THEME_PRESETS } from "./presets";
import { resolveTheme, themeStyle } from "./resolve";

const clair = THEME_PRESETS.find((preset) => preset.id === "clair")!;

describe("resolveTheme", () => {
  test("TPL-019 unknown preset and font fall back to defaults", () => {
    const theme = resolveTheme({ preset: "retire", font: "inconnue" });
    expect(theme.presetId).toBe("clair");
    expect(theme.fontId).toBe("moderne");
    expect(theme.accent).toBe(clair.accent);
  });

  test("TPL-019 absent or malformed input resolves to the default preset", () => {
    for (const raw of [undefined, null, {}, "clair", 42, [], { preset: 3 }]) {
      expect(resolveTheme(raw).presetId).toBe("clair");
    }
  });

  test("TPL-019 an unknown font keeps the font of the preset", () => {
    const editorial = THEME_PRESETS.find((preset) => preset.font === "editorial")!;
    expect(resolveTheme({ preset: editorial.id, font: "inconnue" }).fontId).toBe("editorial");
    expect(resolveTheme({ preset: editorial.id, font: "chaleureux" }).fontId).toBe("chaleureux");
  });

  test("TPL-010 TPL-017 overrides apply, invalid ones are ignored", () => {
    const theme = resolveTheme({
      preset: "clair",
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
      preset: "clair",
      accent: "url(x)",
      text: "#fff; background:url(x)",
      background: { kind: "gradient", from: "#000000", to: "red", angle: 90 },
      header_gradient: 150,
      button_shape: "hexagon",
    });
    expect(invalid.accent).toBe(clair.accent);
    expect(invalid.text).toBe(clair.text);
    expect(invalid.background).toEqual(clair.background);
    expect(invalid.headerGradient).toBe(clair.headerGradient);
    expect(invalid.buttonShape).toBe(clair.buttonShape);
  });

  test("TPL-017 out-of-grammar values are ignored one by one", () => {
    const base = resolveTheme({ preset: "clair" });
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
      expect(resolveTheme({ preset: "clair", ...override }), JSON.stringify(override)).toEqual(base);
    }
  });

  test("TPL-017 boundary values are accepted", () => {
    const theme = resolveTheme({
      preset: "clair",
      header_gradient: 0,
      background: { kind: "gradient", from: "#000000", to: "#ffffff", angle: 360 },
    });
    expect(theme.headerGradient).toBe(0);
    expect(theme.background).toMatchObject({ kind: "gradient", angle: 360 });
    expect(resolveTheme({ preset: "clair", header_gradient: 100 }).headerGradient).toBe(100);
  });

  test("TPL-010 themeStyle exposes css variables", () => {
    const pill = themeStyle(
      resolveTheme({
        preset: "clair",
        button_shape: "pill",
        header_gradient: 50,
        background: { kind: "gradient", from: "#102030", to: "#405060", angle: 90 },
      }),
    ) as Record<string, string>;
    expect(pill["--card-radius"]).toBe("9999px");
    expect(pill["--card-bg"]).toBe("linear-gradient(90deg, #102030, #405060)");
    expect(pill["--card-header-gradient"]).toBe("0.5");
    expect(pill["--card-accent"]).toBe(clair.accent);
    expect(pill["--card-text"]).toBe(clair.text);
    expect(pill["--card-font-heading"]).toContain("Inter Variable");
    expect(pill["--card-font-body"]).toContain("Inter Variable");

    const square = themeStyle(resolveTheme({ preset: "clair", button_shape: "square" })) as Record<string, string>;
    expect(square["--card-radius"]).toBe("0");
    expect(square["--card-bg"]).toBe("#ffffff");
    const rounded = themeStyle(resolveTheme({ preset: "clair", button_shape: "rounded" })) as Record<string, string>;
    expect(rounded["--card-radius"]).toBe("0.75rem");
  });

  test("TPL-017 no css-injection payload reaches the style", () => {
    const style = themeStyle(
      resolveTheme({
        preset: "clair",
        accent: "url(https://evil.example/x)",
        text: "red; background:url(x)",
        font: "x;}body{display:none",
      }),
    );
    for (const value of Object.values(style)) expect(String(value)).not.toMatch(/url\(|evil|;|\{/);
  });
});
