"use client";

import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { hasContrastWarning } from "@/lib/theme/contrast";
import { applyPresetChange, switchBackgroundKind } from "@/lib/theme/edit";
import { FONT_PAIRS, THEME_PRESETS, type ButtonShape, type ThemeSettings } from "@/lib/theme/presets";
import { resolveTheme } from "@/lib/theme/resolve";
import { FieldMessage } from "./Field";
import { OptionSelect } from "./OptionSelect";

const BUTTON_SHAPES: readonly ButtonShape[] = ["square", "rounded", "pill"];

function ColorInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        data-testid={id}
        type="color"
        className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}

/**
 * spec: TPL-009, TPL-010, TPL-011, TPL-013, TPL-018. A theme preset as the starting point, then the owner's
 * overrides: accent, background, text, header gradient, button shape and font. A low contrast between the
 * text and the background shows a warning, it never blocks saving.
 */
export function ThemeEditor({
  theme,
  onChange,
  error,
}: {
  theme: ThemeSettings;
  onChange: (theme: ThemeSettings) => void;
  /** Translated message of a refused theme. */
  error?: string | undefined;
}) {
  const t = useTranslations();
  const resolved = resolveTheme(theme);
  const background = resolved.background;
  const set = (patch: Partial<ThemeSettings>) => onChange({ ...theme, ...patch });

  return (
    <div className="space-y-5">
      <FieldMessage path="theme" message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="theme-preset">{t("editor.theme.preset")}</Label>
          <OptionSelect
            id="theme-preset"
            testId="theme-preset"
            value={resolved.presetId}
            options={THEME_PRESETS.map((preset) => ({ value: preset.id, label: t(preset.nameKey) }))}
            onValueChange={(preset) => onChange(applyPresetChange(preset))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="theme-font">{t("editor.theme.font")}</Label>
          <OptionSelect
            id="theme-font"
            testId="theme-font"
            value={resolved.fontId}
            options={FONT_PAIRS.map((pair) => ({ value: pair.id, label: t(pair.nameKey) }))}
            onValueChange={(font) => set({ font })}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ColorInput
          id="theme-accent"
          label={t("editor.theme.accent")}
          value={resolved.accent}
          onChange={(accent) => set({ accent })}
        />
        <ColorInput
          id="theme-text"
          label={t("editor.theme.text")}
          value={resolved.text}
          onChange={(text) => set({ text })}
        />
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="theme-background-kind">{t("editor.theme.background")}</Label>
          <OptionSelect
            id="theme-background-kind"
            testId="theme-background-kind"
            value={background.kind}
            options={[
              { value: "solid", label: t("editor.theme.backgroundSolid") },
              { value: "gradient", label: t("editor.theme.backgroundGradient") },
            ]}
            onValueChange={(kind) => onChange(switchBackgroundKind(theme, kind as "solid" | "gradient"))}
          />
        </div>
        {background.kind === "solid" ? (
          <ColorInput
            id="theme-background-color"
            label={t("editor.theme.backgroundColor")}
            value={background.color}
            onChange={(color) => set({ background: { kind: "solid", color } })}
          />
        ) : (
          <div className="space-y-3">
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorInput
                id="theme-gradient-from"
                label={t("editor.theme.gradientFrom")}
                value={background.from}
                onChange={(from) => set({ background: { ...background, from } })}
              />
              <ColorInput
                id="theme-gradient-to"
                label={t("editor.theme.gradientTo")}
                value={background.to}
                onChange={(to) => set({ background: { ...background, to } })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="theme-gradient-angle">
                {t("editor.theme.gradientAngle")} <span className="text-muted-foreground">{background.angle}°</span>
              </Label>
              <Slider
                id="theme-gradient-angle"
                data-testid="theme-gradient-angle"
                aria-label={t("editor.theme.gradientAngle")}
                min={0}
                max={360}
                step={1}
                value={[background.angle]}
                onValueChange={([angle]) => {
                  if (angle !== undefined) set({ background: { ...background, angle } });
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="theme-header-gradient">
          {t("editor.theme.headerGradient")}{" "}
          <span className="text-muted-foreground">{resolved.headerGradient} %</span>
        </Label>
        <Slider
          id="theme-header-gradient"
          data-testid="theme-header-gradient"
          aria-label={t("editor.theme.headerGradient")}
          min={0}
          max={100}
          step={1}
          value={[resolved.headerGradient]}
          onValueChange={([header_gradient]) => {
            if (header_gradient !== undefined) set({ header_gradient });
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="theme-button-shape">{t("editor.theme.buttonShape")}</Label>
        <OptionSelect
          id="theme-button-shape"
          testId="theme-button-shape"
          value={resolved.buttonShape}
          options={BUTTON_SHAPES.map((shape) => ({ value: shape, label: t(`editor.theme.shapes.${shape}`) }))}
          onValueChange={(shape) => set({ button_shape: shape as ButtonShape })}
        />
      </div>

      {hasContrastWarning(resolved) ? (
        <p
          data-testid="contrast-warning"
          role="status"
          className="rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          {t("editor.theme.contrastWarning")}
        </p>
      ) : null}
    </div>
  );
}
