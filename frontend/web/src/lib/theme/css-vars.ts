import type { CSSProperties } from "react";
import type { ButtonShape } from "./presets";
import type { ResolvedTheme } from "./resolve";

const RADIUS: Record<ButtonShape, string> = { square: "2px", rounded: "12px", pill: "999px" };
const DANGER = { light: "#B3261E", dark: "#FF8A80" };

/**
 * CSS custom properties a template reads to paint the card (TPL-026). They are set on the element holding
 * the card, never on `:root`, and only card variables are set.
 */
export function themeToCssVars(theme: ResolvedTheme): CSSProperties {
  const { background } = theme;
  const [from, to, angle] =
    background.kind === "solid"
      ? [background.color, background.color, 180]
      : [background.from, background.to, background.angle];
  const vars: Record<string, string> = {
    "--c-accent": theme.accent,
    "--c-on-accent": theme.onAccent,
    "--c-bg": from,
    "--c-bg-2": to,
    "--bg-angle": `${angle}deg`,
    "--c-text": theme.text,
    "--fade": String(theme.headerGradient),
    "--radius-btn": RADIUS[theme.buttonShape],
    "--font-title": theme.fontPair.titleStack,
    "--font-body": theme.fontPair.bodyStack,
    "--title-weight": String(theme.fontPair.titleWeight),
    "--title-tracking": theme.fontPair.titleTracking,
    "--c-danger": DANGER[theme.colorScheme],
    colorScheme: theme.colorScheme,
  };
  return vars as CSSProperties;
}
