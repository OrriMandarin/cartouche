import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { hasContrastWarning } from "./contrast";
import { DEFAULT_FONT_ID, DEFAULT_PRESET_ID, FONT_PAIRS, THEME_PRESETS } from "./presets";
import { resolveTheme } from "./resolve";

describe("theme presets", () => {
  test("TPL-009 six presets, all readable", () => {
    const ids = THEME_PRESETS.map((preset) => preset.id);
    expect(ids).toEqual(["clair", "sombre", "sable", "ocean", "foret", "corail"]);
    expect(new Set(ids).size).toBe(6);
    expect(ids).toContain(DEFAULT_PRESET_ID);
    for (const id of ids) {
      expect(hasContrastWarning(resolveTheme({ preset: id })), id).toBe(false);
    }
  });

  test("TPL-009 presets are named through message keys", () => {
    for (const preset of THEME_PRESETS) {
      expect(preset.nameKey).toBe(`themes.${preset.id}`);
      expect(FONT_PAIRS.map((pair) => pair.id)).toContain(preset.font);
    }
  });

  test("TPL-011 TPL-012 font pairs come from self-hosted packages", () => {
    expect(FONT_PAIRS.map((pair) => [pair.id, pair.heading, pair.body])).toEqual([
      ["moderne", expect.stringContaining("Inter Variable"), expect.stringContaining("Inter Variable")],
      [
        "editorial",
        expect.stringContaining("Playfair Display Variable"),
        expect.stringContaining("Source Sans 3 Variable"),
      ],
      [
        "chaleureux",
        expect.stringContaining("Fraunces Variable"),
        expect.stringContaining("Nunito Sans Variable"),
      ],
    ]);
    expect(FONT_PAIRS.map((pair) => pair.id)).toContain(DEFAULT_FONT_ID);
    for (const pair of FONT_PAIRS) expect(pair.nameKey).toBe(`fonts.${pair.id}`);

    const css = readFileSync(join(process.cwd(), "src/lib/theme/fonts.css"), "utf8");
    const imports = [...css.matchAll(/@import\s+["']([^"']+)["']/g)].map((match) => match[1]);
    expect(imports).toHaveLength(8);
    for (const target of imports) expect(target).toMatch(/^@fontsource-variable\//);
    expect(css).not.toMatch(/googleapis|gstatic|https?:/i);
  });
});
