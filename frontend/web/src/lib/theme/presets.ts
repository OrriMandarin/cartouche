import type { components } from "@cartouche/api-client";
import { DEFAULT_FONT_ID, FONT_PAIRS, type FontPair } from "./fonts";

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
  /** Header gradient intensity, 0 to 100. */
  headerGradient: number;
  buttonShape: ButtonShape;
  /** Id of the font pair. */
  font: string;
}

export const DEFAULT_PRESET_ID = "clair";

// Placeholder palettes: sober and readable, replaced by the final design in plan 6.
export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: "clair",
    nameKey: "themes.clair",
    accent: "#2563eb",
    text: "#111827",
    background: { kind: "solid", color: "#ffffff" },
    headerGradient: 40,
    buttonShape: "rounded",
    font: "moderne",
  },
  {
    id: "sombre",
    nameKey: "themes.sombre",
    accent: "#60a5fa",
    text: "#f3f4f6",
    background: { kind: "solid", color: "#111827" },
    headerGradient: 30,
    buttonShape: "rounded",
    font: "moderne",
  },
  {
    id: "sable",
    nameKey: "themes.sable",
    accent: "#9a5b2e",
    text: "#3b2f2f",
    background: { kind: "solid", color: "#f5ecdc" },
    headerGradient: 50,
    buttonShape: "square",
    font: "editorial",
  },
  {
    id: "ocean",
    nameKey: "themes.ocean",
    accent: "#38bdf8",
    text: "#f0f9ff",
    background: { kind: "gradient", from: "#0c4a6e", to: "#155e75", angle: 160 },
    headerGradient: 60,
    buttonShape: "pill",
    font: "moderne",
  },
  {
    id: "foret",
    nameKey: "themes.foret",
    accent: "#15803d",
    text: "#14291c",
    background: { kind: "solid", color: "#ecf5ee" },
    headerGradient: 40,
    buttonShape: "rounded",
    font: "chaleureux",
  },
  {
    id: "corail",
    nameKey: "themes.corail",
    accent: "#e11d48",
    text: "#3f1d1d",
    background: { kind: "gradient", from: "#fff1ee", to: "#ffe4de", angle: 135 },
    headerGradient: 50,
    buttonShape: "pill",
    font: "chaleureux",
  },
];
