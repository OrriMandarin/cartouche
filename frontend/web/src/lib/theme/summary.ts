import { THEME_PRESETS, type ThemeSettings } from "./presets";
import { resolveTheme } from "./resolve";

/** A message lookup, such as next-intl's `t`, so that the summary is built and tested outside React. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/** spec: EDI-030. The theme's name, followed by ", personnalisé" once one of its settings differs from it. */
export function themeSummary(theme: ThemeSettings, t: Translate): string {
  const resolved = resolveTheme(theme);
  const preset = THEME_PRESETS.find((candidate) => candidate.id === resolved.presetId) ?? THEME_PRESETS[0]!;
  const original = resolveTheme({ preset: preset.id });
  // Both come out of resolveTheme with the same keys in the same order.
  const customized = JSON.stringify(resolved) !== JSON.stringify(original);
  const name = t(preset.nameKey);
  return customized ? t("editor.summary.themeCustomized", { name }) : name;
}
