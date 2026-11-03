import type { ResolvedTheme } from "./resolve";

/** Minimum WCAG 2.x contrast ratio for normal text (TPL-018). */
const MIN_CONTRAST = 4.5;

function channel(hex: string, start: number): number {
  const value = parseInt(hex.slice(start, start + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color: string): number {
  return 0.2126 * channel(color, 1) + 0.7152 * channel(color, 3) + 0.0722 * channel(color, 5);
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colors, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** True when the text is hard to read on the background; a gradient counts by its worst stop. */
export function hasContrastWarning(theme: ResolvedTheme): boolean {
  const stops =
    theme.background.kind === "solid"
      ? [theme.background.color]
      : [theme.background.from, theme.background.to];
  return Math.min(...stops.map((stop) => contrastRatio(theme.text, stop))) < MIN_CONTRAST;
}
