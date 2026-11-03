import { describe, expect, test } from "vitest";
import { themeToCssVars } from "./css-vars";
import { resolveTheme } from "./resolve";

const vars = (raw: unknown) => themeToCssVars(resolveTheme(raw)) as Record<string, string>;

describe("themeToCssVars", () => {
  test("TPL-021 TPL-022 css variables carry the text on accent and the scheme", () => {
    expect(vars({ preset: "encre" })).toMatchObject({
      "--c-accent": "#c8f04d",
      "--c-on-accent": "#111111",
      colorScheme: "dark",
      "--c-danger": "#FF8A80",
    });
    expect(vars({ preset: "craie" })).toMatchObject({
      "--c-on-accent": "#FFFFFF",
      colorScheme: "light",
      "--c-danger": "#B3261E",
    });
  });

  test("TPL-010 a solid background gives the same colour twice and 180deg", () => {
    expect(vars({ preset: "craie" })).toMatchObject({
      "--c-bg": "#f7f6f2",
      "--c-bg-2": "#f7f6f2",
      "--bg-angle": "180deg",
    });
  });

  test("TPL-010 a gradient gives its two colours and its angle", () => {
    expect(vars({ preset: "terracotta" })).toMatchObject({
      "--c-bg": "#fbf0e4",
      "--c-bg-2": "#f4dcca",
      "--bg-angle": "160deg",
    });
  });

  test("TPL-010 TPL-011 shape, fade and fonts", () => {
    expect(vars({ preset: "craie", button_shape: "square", header_gradient: 50 })).toMatchObject({
      "--radius-btn": "2px",
      "--fade": "50",
    });
    expect(vars({ preset: "craie", button_shape: "rounded" })["--radius-btn"]).toBe("12px");
    expect(vars({ preset: "craie", button_shape: "pill" })["--radius-btn"]).toBe("999px");
    expect(vars({ preset: "ivoire" })).toMatchObject({
      "--font-title": "'Playfair Display Variable', 'Playfair Display', Georgia, serif",
      "--font-body": "'Source Sans 3 Variable', 'Source Sans 3', system-ui, sans-serif",
      "--title-weight": "600",
      "--title-tracking": "-0.005em",
    });
  });

  test("TPL-026 themeToCssVars sets only card variables", () => {
    for (const preset of ["craie", "encre", "minuit"]) {
      for (const key of Object.keys(vars({ preset }))) {
        expect(key, key).toMatch(/^(--c-|--bg-|--fade$|--radius-btn$|--font-|--title-|colorScheme$)/);
      }
    }
  });
});
