import {
  failedChecks,
  measureContrast,
  MIN_CONTRAST,
  readableFix,
  settingOf,
  type ContrastCheck,
} from "./contrast";
import { THEME_PRESETS, type ThemeSettings } from "./presets";
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

export interface ContrastIssue {
  /** The setting the issue is fixed through (TPL-013). */
  setting: "text" | "accent";
  check: ContrastCheck;
  /** Measured ratio. */
  ratio: number;
  /** Required ratio. */
  minimum: number;
  /** Lowercase `#rrggbb` that makes every check pass in this setting; null when there is none (TPL-024). */
  fix: string | null;
}

export interface ContrastReport {
  /** At most one issue per setting: its first failed check. */
  issues: ContrastIssue[];
  /** Check 1 (text on the background) and check 3 (text on the accent), for the "Lisible" line (EDI-030). */
  textRatio: number;
  buttonRatio: number;
}

/**
 * spec: TPL-013, TPL-018, TPL-024, EDI-030. The state of the contrast checks of the theme as it will be
 * rendered, with the fix of each setting that fails.
 */
export function contrastReport(theme: ThemeSettings): ContrastReport {
  const resolved = resolveTheme(theme);
  const preset = THEME_PRESETS.find((candidate) => candidate.id === resolved.presetId) ?? THEME_PRESETS[0]!;
  const measured = measureContrast(resolved);
  const failed = failedChecks(resolved);
  const issues = (["text", "accent"] as const).flatMap((setting) => {
    const check = failed.find((candidate) => settingOf(candidate) === setting);
    if (check === undefined) return [];
    return [
      {
        setting,
        check,
        ratio: measured[check],
        minimum: MIN_CONTRAST[check],
        fix: readableFix(resolved, setting, preset[setting]),
      },
    ];
  });
  return { issues, textRatio: measured.text, buttonRatio: measured.onAccent };
}
