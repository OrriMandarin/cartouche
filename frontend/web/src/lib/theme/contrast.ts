import { contrastRatio, mixOklab, over, parseHex, relativeLuminance, toHex, type Rgb } from "./color";
import type { ResolvedTheme } from "./resolve";

export type ContrastCheck = "text" | "mutedOnHover" | "onAccent" | "accentVsBg";

/** Minimum WCAG 2.x ratio of each check (TPL-018). */
export const MIN_CONTRAST: Record<ContrastCheck, number> = {
  text: 4.5,
  mutedOnHover: 4.5,
  onAccent: 4.5,
  accentVsBg: 3,
};

const CHECKS: ContrastCheck[] = ["text", "mutedOnHover", "onAccent", "accentVsBg"];

export interface ThemeColors {
  accent: string;
  text: string;
  background:
    | { kind: "solid"; color: string }
    | { kind: "gradient"; from: string; to: string; angle: number };
}

const WHITE = "#FFFFFF";
const NEAR_BLACK = "#111111";

/** The text colour put on the accent: white or near-black, whichever reads better; white on a tie (TPL-021). */
export function onAccentFor(accent: string): "#FFFFFF" | "#111111" {
  const rgb = parseHex(accent);
  return contrastRatio(parseHex(WHITE), rgb) >= contrastRatio(parseHex(NEAR_BLACK), rgb)
    ? WHITE
    : NEAR_BLACK;
}

/** A theme is dark when its text is lighter than its background (TPL-022). */
export function isDarkTheme(colors: ThemeColors): boolean {
  return relativeLuminance(parseHex(colors.text)) > relativeLuminance(parseHex(firstStop(colors)));
}

function stopsOf(colors: ThemeColors): [string, ...string[]] {
  return colors.background.kind === "solid"
    ? [colors.background.color]
    : [colors.background.from, colors.background.to];
}

function firstStop(colors: ThemeColors): string {
  return stopsOf(colors)[0];
}

/** Worst measured ratio of each check; a gradient is measured on both of its colours (TPL-018). */
export function measureContrast(colors: ThemeColors): Record<ContrastCheck, number> {
  const text = parseHex(colors.text);
  const accent = parseHex(colors.accent);
  const [first, ...rest] = stopsOf(colors).map(parseHex) as [Rgb, ...Rgb[]];
  const stops = [first, ...rest];
  const muted = mixOklab(text, first, 0.78);
  const hover = (stop: Rgb) => over(text, stop, 0.12);
  return {
    text: Math.min(...stops.map((stop) => contrastRatio(text, stop))),
    mutedOnHover: Math.min(...stops.map((stop) => contrastRatio(muted, hover(stop)))),
    onAccent: contrastRatio(parseHex(onAccentFor(colors.accent)), accent),
    accentVsBg: Math.min(...stops.map((stop) => contrastRatio(accent, hover(stop)))),
  };
}

export function failedChecks(colors: ThemeColors): ContrastCheck[] {
  const measured = measureContrast(colors);
  return CHECKS.filter((check) => measured[check] < MIN_CONTRAST[check]);
}

/** The setting a failed check is fixed through. */
export function settingOf(check: ContrastCheck): "text" | "accent" {
  return check === "text" || check === "mutedOnHover" ? "text" : "accent";
}

/** The first of the preset value, near-black and white that makes every check pass once put in `setting` (TPL-024). */
export function readableFix(
  colors: ThemeColors,
  setting: "text" | "accent",
  presetValue: string,
): string | null {
  const candidate = [presetValue, NEAR_BLACK, WHITE].find(
    (value) => failedChecks({ ...colors, [setting]: value }).length === 0,
  );
  return candidate === undefined ? null : toHex(parseHex(candidate));
}

/** One decimal, decimal comma, rounded down so a failing ratio never reads as passing (TPL-013). */
export function formatRatio(ratio: number): string {
  return (Math.floor(ratio * 10) / 10).toFixed(1).replace(".", ",");
}

/** True when the text is hard to read on the background; a gradient counts by its worst stop. */
export function hasContrastWarning(theme: ResolvedTheme): boolean {
  const text = parseHex(theme.text);
  const stops =
    theme.background.kind === "solid"
      ? [theme.background.color]
      : [theme.background.from, theme.background.to];
  return Math.min(...stops.map((stop) => contrastRatio(text, parseHex(stop)))) < MIN_CONTRAST.text;
}
