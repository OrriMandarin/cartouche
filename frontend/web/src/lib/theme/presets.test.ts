import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { failedChecks } from "./contrast";
import { FONT_PAIRS } from "./fonts";
import { DEFAULT_PRESET_ID, THEME_PRESETS } from "./presets";

describe("theme presets", () => {
  test("TPL-009 eight ready-made themes, craie first and by default, all readable", () => {
    const ids = THEME_PRESETS.map((preset) => preset.id);
    expect(ids).toEqual(["craie", "ivoire", "terracotta", "sauge", "bonbon", "lagon", "encre", "minuit"]);
    expect(DEFAULT_PRESET_ID).toBe("craie");
    for (const preset of THEME_PRESETS) {
      expect(failedChecks(preset), preset.id).toEqual([]);
    }
  });

  test("TPL-009 presets are named through message keys and carry the design's values", () => {
    for (const preset of THEME_PRESETS) {
      expect(preset.nameKey).toBe(`themes.${preset.id}`);
      expect(FONT_PAIRS.map((pair) => pair.id)).toContain(preset.font);
    }
    const encre = THEME_PRESETS.find((preset) => preset.id === "encre")!;
    expect(encre).toMatchObject({
      accent: "#c8f04d",
      text: "#f1f0ec",
      background: { kind: "solid", color: "#121316" },
      headerGradient: 75,
      buttonShape: "pill",
      font: "inter",
    });
    const terracotta = THEME_PRESETS.find((preset) => preset.id === "terracotta")!;
    expect(terracotta.background).toEqual({ kind: "gradient", from: "#fbf0e4", to: "#f4dcca", angle: 160 });
  });

  test("TPL-011 four font pairs with their weights and stacks", () => {
    expect(FONT_PAIRS.map((pair) => pair.id)).toEqual(["inter", "playfair", "fraunces", "bricolage"]);
    const playfair = FONT_PAIRS.find((pair) => pair.id === "playfair")!;
    expect(playfair).toMatchObject({
      nameKey: "fonts.playfair",
      title: "Playfair Display",
      body: "Source Sans 3",
      titleWeight: 600,
      titleTracking: "-0.005em",
      titleStack: "'Playfair Display Variable', 'Playfair Display', Georgia, serif",
      bodyStack: "'Source Sans 3 Variable', 'Source Sans 3', system-ui, sans-serif",
    });
    const bricolage = FONT_PAIRS.find((pair) => pair.id === "bricolage")!;
    expect(bricolage.titleStack).toBe("'Bricolage Grotesque Variable', 'Bricolage Grotesque', system-ui, sans-serif");
    expect(FONT_PAIRS.find((pair) => pair.id === "fraunces")!.titleStack).toMatch(/Georgia, serif$/);
  });

  test("TPL-012 fonts come from self-hosted packages", () => {
    const css = readFileSync(join(process.cwd(), "src/lib/theme/fonts.css"), "utf8");
    const imports = [...css.matchAll(/@import\s+["']([^"']+)["']/g)].map((match) => match[1]);
    expect(imports).toHaveLength(8);
    for (const target of imports) expect(target).toMatch(/^@fontsource-variable\//);
    expect(css).not.toMatch(/googleapis|gstatic|https?:/i);
  });
});
