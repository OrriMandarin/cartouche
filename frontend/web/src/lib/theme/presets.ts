import type { components } from "@cartouche/api-client";
import { DEFAULT_FONT_ID, FONT_PAIRS, type FontPair } from "./fonts";
import themesJson from "./themes.json";

export { DEFAULT_FONT_ID, FONT_PAIRS, type FontPair };

export type ThemeSettings = components["schemas"]["Theme"];
export type ThemeBackground = components["schemas"]["Background"];
export type ButtonShape = components["schemas"]["ButtonShape"];

export interface ThemePreset {
  id: string;
  /** Message key of the display name. */
  nameKey: string;
  accent: string;
  text: string;
  background: ThemeBackground;
  /** Header fade intensity, 0 to 100. */
  headerGradient: number;
  buttonShape: ButtonShape;
  /** Id of the font pair. */
  font: string;
}

export const DEFAULT_PRESET_ID = "craie";

export type JsonBackground =
  | { type: "solid"; color: string }
  | { type: "gradient"; from: string; to: string; angle: number };

/** A background of `themes.json`, in the API grammar. */
export function backgroundOf(background: JsonBackground): ThemeBackground {
  return background.type === "solid"
    ? { kind: "solid", color: background.color.toLowerCase() }
    : {
        kind: "gradient",
        from: background.from.toLowerCase(),
        to: background.to.toLowerCase(),
        angle: background.angle,
      };
}

/** The eight ready-made themes of the design (TPL-009), in the design's order. */
export const THEME_PRESETS: readonly ThemePreset[] = themesJson.themes.map((theme) => ({
  id: theme.id,
  nameKey: `themes.${theme.id}`,
  accent: theme.accent.toLowerCase(),
  text: theme.text.toLowerCase(),
  background: backgroundOf(theme.background as JsonBackground),
  headerGradient: theme.headerFade,
  buttonShape: theme.buttonShape as ButtonShape,
  font: theme.fontPair,
}));
