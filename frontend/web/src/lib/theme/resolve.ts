import { isDarkTheme, onAccentFor } from "./contrast";
import {
  DEFAULT_FONT_ID,
  DEFAULT_PRESET_ID,
  FONT_PAIRS,
  THEME_PRESETS,
  type ButtonShape,
  type FontPair,
  type ThemeBackground,
} from "./presets";

/** A theme with every value present and valid, ready to render. */
export interface ResolvedTheme {
  presetId: string;
  fontId: string;
  accent: string;
  text: string;
  background: ThemeBackground;
  /** Header gradient intensity, 0 to 100. */
  headerGradient: number;
  buttonShape: ButtonShape;
  fontPair: FontPair;
  /** Text colour put on the accent (TPL-021). */
  onAccent: string;
  /** Native scheme of the card: dark when its text is lighter than its background (TPL-022). */
  colorScheme: "light" | "dark";
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
const BUTTON_SHAPES: readonly ButtonShape[] = ["square", "rounded", "pill"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function color(value: unknown): string | undefined {
  return typeof value === "string" && COLOR.test(value) ? value.toLowerCase() : undefined;
}

function integerInRange(value: unknown, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max
    ? value
    : undefined;
}

function background(value: unknown): ThemeBackground | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "solid") {
    const solid = color(value.color);
    return solid ? { kind: "solid", color: solid } : undefined;
  }
  if (value.kind === "gradient") {
    const from = color(value.from);
    const to = color(value.to);
    const angle = integerInRange(value.angle, 360);
    return from && to && angle !== undefined ? { kind: "gradient", from, to, angle } : undefined;
  }
  return undefined;
}

/**
 * Reads a stored theme for rendering (TPL-019): an unknown preset or font falls back to the
 * defaults and any override outside the TPL-017 grammar is ignored, so no raw value reaches CSS.
 */
export function resolveTheme(raw: unknown): ResolvedTheme {
  const input = isRecord(raw) ? raw : {};
  const preset =
    THEME_PRESETS.find((candidate) => candidate.id === input.preset) ??
    THEME_PRESETS.find((candidate) => candidate.id === DEFAULT_PRESET_ID) ??
    THEME_PRESETS[0]!;
  const fontPair =
    FONT_PAIRS.find((pair) => pair.id === input.font) ??
    FONT_PAIRS.find((pair) => pair.id === preset.font) ??
    FONT_PAIRS.find((pair) => pair.id === DEFAULT_FONT_ID) ??
    FONT_PAIRS[0]!;
  const shape = BUTTON_SHAPES.find((candidate) => candidate === input.button_shape);

  const accent = color(input.accent) ?? preset.accent;
  const text = color(input.text) ?? preset.text;
  const resolvedBackground = background(input.background) ?? preset.background;

  return {
    presetId: preset.id,
    fontId: fontPair.id,
    accent,
    text,
    background: resolvedBackground,
    headerGradient: integerInRange(input.header_gradient, 100) ?? preset.headerGradient,
    buttonShape: shape ?? preset.buttonShape,
    fontPair,
    onAccent: onAccentFor(accent),
    colorScheme: isDarkTheme({ accent, text, background: resolvedBackground }) ? "dark" : "light",
  };
}
