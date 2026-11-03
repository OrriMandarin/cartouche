import type { ThemeSettings } from "./presets";
import { resolveTheme } from "./resolve";

const DEFAULT_GRADIENT_ANGLE = 135;

/**
 * spec: TPL-009, TPL-010. Another preset: a preset is a starting point, so the owner's overrides of the
 * previous look are dropped (R-T17b).
 */
export function applyPresetChange(presetId: string): ThemeSettings {
  return { preset: presetId };
}

/**
 * spec: TPL-010. Switches the background between a solid color and a gradient, keeping what the owner sees:
 * a gradient from a solid color starts and ends there (the end is the accent, at a 135 degree angle), a solid
 * color from a gradient is the gradient's first color (R-T17b).
 */
export function switchBackgroundKind(theme: ThemeSettings, kind: "solid" | "gradient"): ThemeSettings {
  const resolved = resolveTheme(theme);
  const { background } = resolved;
  if (background.kind === kind) return theme;
  return {
    ...theme,
    background:
      background.kind === "gradient"
        ? { kind: "solid", color: background.from }
        : { kind: "gradient", from: background.color, to: resolved.accent, angle: DEFAULT_GRADIENT_ANGLE },
  };
}
