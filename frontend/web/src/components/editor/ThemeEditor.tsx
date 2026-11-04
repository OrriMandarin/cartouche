"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { BUTTON_RADIUS } from "@/lib/theme/css-vars";
import { applyPresetChange, contrastReport, switchBackgroundKind, type ContrastIssue } from "@/lib/theme/edit";
import { formatRatio } from "@/lib/theme/contrast";
import {
  FONT_PAIRS,
  THEME_PRESETS,
  type ButtonShape,
  type ThemeBackground,
  type ThemePreset,
  type ThemeSettings,
} from "@/lib/theme/presets";
import { resolveTheme } from "@/lib/theme/resolve";
import { ColorField } from "./ColorField";
import { FieldMessage } from "./Field";
import { OptionSelect } from "./OptionSelect";
import { SegmentedSelect } from "./SegmentedSelect";

const BUTTON_SHAPES: readonly ButtonShape[] = ["square", "rounded", "pill"];

function backgroundCss(background: ThemeBackground): string {
  return background.kind === "solid"
    ? background.color
    : `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})`;
}

/** The ratio as a French decimal; a whole minimum reads « 3 », not « 3,0 ». */
function formatMinimum(minimum: number): string {
  return String(minimum).replace(".", ",");
}

/** A theme thumbnail: « Aa » in the theme's font on its colours, and a pill in its accent. */
function PresetThumbnail({ preset, name, checked }: { preset: ThemePreset; name: string; checked: boolean }) {
  const font = FONT_PAIRS.find((pair) => pair.id === preset.font) ?? FONT_PAIRS[0]!;
  return (
    <span className="flex flex-col items-stretch gap-1.5 text-left">
      <span
        aria-hidden="true"
        style={{ background: backgroundCss(preset.background) }}
        className="relative flex h-[84px] flex-col justify-between rounded-xl p-2.5 shadow-[inset_0_0_0_1px_rgb(28_27_25/0.14)] group-data-[state=checked]:outline-2 group-data-[state=checked]:outline-offset-2 group-data-[state=checked]:outline-[var(--app-text)]"
      >
        <span
          style={{
            fontFamily: font.titleStack,
            fontWeight: font.titleWeight,
            letterSpacing: font.titleTracking,
            color: preset.text,
          }}
          className="text-2xl leading-none"
        >
          Aa
        </span>
        <span
          style={{ background: preset.accent, borderRadius: BUTTON_RADIUS[preset.buttonShape] }}
          className="block h-3 w-[70%]"
        />
        {checked ? (
          <span className="bg-app-primary text-app-on-primary absolute top-1.5 right-1.5 grid size-[22px] place-items-center rounded-full">
            <Check className="size-3.5" />
          </span>
        ) : null}
      </span>
      <span className="text-app-text text-[13px] font-semibold">{name}</span>
    </span>
  );
}

function ContrastAlert({
  issue,
  onFix,
  disabled,
}: {
  issue: ContrastIssue;
  onFix: (hex: string) => void;
  disabled?: boolean | undefined;
}) {
  const t = useTranslations("editor.theme.contrast");
  return (
    <div
      role="alert"
      id={`contrast-${issue.setting}`}
      data-testid={`contrast-${issue.setting}`}
      className="bg-app-warning-soft rounded-app flex items-start gap-3 px-4 py-3.5 text-sm leading-[1.45]"
    >
      <TriangleAlert aria-hidden="true" className="text-app-warning mt-px size-5 flex-none" />
      <div className="flex flex-col items-start gap-2">
        <p>
          <b>{t(issue.check)}</b>{" "}
          {t("detail", { ratio: formatRatio(issue.ratio), minimum: formatMinimum(issue.minimum) })} {t("blocked")}
        </p>
        {issue.fix === null ? null : (
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            data-testid={`contrast-fix-${issue.setting}`}
            onClick={() => onFix(issue.fix!)}
          >
            {t("fix", { hex: issue.fix.toUpperCase() })}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * spec: TPL-009, TPL-010, TPL-011, TPL-013, TPL-018, TPL-024, EDI-030. A theme preset as the starting point
 * (thumbnails), then the owner's overrides: accent and text colours, background, header gradient, button
 * shape and font pair. The contrast checks run as the owner edits: a failed check shows its ratio under the
 * settings with a button for a readable colour, and all passing says so. A read-only editor disables every
 * control, the Radix sliders included, which the fieldset around the section does not reach.
 */
export function ThemeEditor({
  theme,
  onChange,
  error,
  disabled,
}: {
  theme: ThemeSettings;
  onChange: (theme: ThemeSettings) => void;
  /** Translated message of a refused theme. */
  error?: string | undefined;
  disabled?: boolean | undefined;
}) {
  const t = useTranslations();
  const resolved = resolveTheme(theme);
  const background = resolved.background;
  const report = contrastReport(theme);
  const issueOf = (setting: ContrastIssue["setting"]) => report.issues.find((issue) => issue.setting === setting);
  const set = (patch: Partial<ThemeSettings>) => onChange({ ...theme, ...patch });

  return (
    <div className="flex flex-col gap-5">
      <FieldMessage path="theme" message={error} />

      <RadioGroup
        aria-label={t("editor.theme.presets")}
        value={resolved.presetId}
        onValueChange={(preset) => onChange(applyPresetChange(preset))}
        disabled={disabled}
        className="grid grid-cols-2 gap-3 bg-transparent p-0 sm:grid-cols-4"
      >
        {THEME_PRESETS.map((preset) => (
          <RadioGroupItem
            key={preset.id}
            value={preset.id}
            aria-label={t(preset.nameKey)}
            data-testid={`theme-preset-${preset.id}`}
            className="group block min-h-0 rounded-none p-0 data-[state=checked]:bg-transparent data-[state=checked]:shadow-none"
          >
            <PresetThumbnail preset={preset} name={t(preset.nameKey)} checked={preset.id === resolved.presetId} />
          </RadioGroupItem>
        ))}
      </RadioGroup>

      <div className="border-app-border grid gap-4 border-t pt-4 sm:grid-cols-2">
        <ColorField
          id="theme-accent"
          label={t("editor.theme.accent")}
          pickLabel={t("editor.theme.pick.accent")}
          value={resolved.accent}
          onChange={(accent) => set({ accent })}
          disabled={disabled}
          invalid={issueOf("accent") !== undefined}
          describedBy={issueOf("accent") ? "contrast-accent" : undefined}
        />
        <ColorField
          id="theme-text"
          label={t("editor.theme.text")}
          pickLabel={t("editor.theme.pick.text")}
          value={resolved.text}
          onChange={(text) => set({ text })}
          disabled={disabled}
          invalid={issueOf("text") !== undefined}
          describedBy={issueOf("text") ? "contrast-text" : undefined}
        />
      </div>

      <div className="flex flex-col gap-3">
        <SegmentedSelect
          label={t("editor.theme.background")}
          testId="theme-background-kind"
          value={background.kind}
          options={[
            { value: "solid", label: t("editor.theme.backgroundSolid") },
            { value: "gradient", label: t("editor.theme.backgroundGradient") },
          ]}
          onValueChange={(kind) => onChange(switchBackgroundKind(theme, kind as "solid" | "gradient"))}
          disabled={disabled}
        />
        {background.kind === "solid" ? (
          <ColorField
            id="theme-background-color"
            label={t("editor.theme.backgroundColor")}
            pickLabel={t("editor.theme.pick.background")}
            value={background.color}
            onChange={(color) => set({ background: { kind: "solid", color } })}
            disabled={disabled}
          />
        ) : (
          <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
            <ColorField
              id="theme-gradient-from"
              label={t("editor.theme.gradientFrom")}
              pickLabel={t("editor.theme.pick.gradientFrom")}
              value={background.from}
              onChange={(from) => set({ background: { ...background, from } })}
              disabled={disabled}
            />
            <ColorField
              id="theme-gradient-to"
              label={t("editor.theme.gradientTo")}
              pickLabel={t("editor.theme.pick.gradientTo")}
              value={background.to}
              onChange={(to) => set({ background: { ...background, to } })}
              disabled={disabled}
            />
            <div className="flex flex-col gap-2">
              <span className="text-sm leading-none font-semibold">{t("editor.theme.gradientAngleShort")}</span>
              <div className="flex items-center gap-2.5">
                <Slider
                  data-testid="theme-gradient-angle"
                  aria-label={t("editor.theme.gradientAngle")}
                  min={0}
                  max={360}
                  step={1}
                  value={[background.angle]}
                  disabled={disabled}
                  onValueChange={([angle]) => {
                    if (angle !== undefined) set({ background: { ...background, angle } });
                  }}
                />
                <span className="font-app-mono w-10 flex-none text-sm">{background.angle}°</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {report.issues.map((issue) => (
        <ContrastAlert
          key={issue.setting}
          issue={issue}
          disabled={disabled}
          onFix={(hex) => set({ [issue.setting]: hex })}
        />
      ))}
      {report.issues.length === 0 ? (
        <p role="status" data-testid="contrast-ok" className="text-app-success flex items-start gap-2 text-sm font-semibold">
          <Check aria-hidden="true" className="mt-px size-5 flex-none" />
          {t("editor.theme.contrast.ok", {
            text: formatRatio(report.textRatio),
            buttons: formatRatio(report.buttonRatio),
          })}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-sm leading-none font-semibold">{t("editor.theme.headerGradient")}</span>
        <div className="flex items-center gap-3">
          <Slider
            data-testid="theme-header-gradient"
            aria-label={t("editor.theme.headerGradient")}
            min={0}
            max={100}
            step={1}
            value={[resolved.headerGradient]}
            disabled={disabled}
            onValueChange={([header_gradient]) => {
              if (header_gradient !== undefined) set({ header_gradient });
            }}
          />
          <span className="font-app-mono w-8 flex-none text-sm">{resolved.headerGradient}</span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SegmentedSelect
          label={t("editor.theme.buttonShape")}
          testId="theme-button-shape"
          value={resolved.buttonShape}
          options={BUTTON_SHAPES.map((shape) => ({ value: shape, label: t(`editor.theme.shapes.${shape}`) }))}
          onValueChange={(shape) => set({ button_shape: shape as ButtonShape })}
          disabled={disabled}
          block
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor="theme-font" className="font-semibold">
            {t("editor.theme.font")}
          </Label>
          <OptionSelect
            id="theme-font"
            testId="theme-font"
            value={resolved.fontId}
            options={FONT_PAIRS.map((pair) => ({
              value: pair.id,
              label: t("editor.theme.fontOption", { name: t(pair.nameKey), title: pair.title, body: pair.body }),
            }))}
            onValueChange={(font) => set({ font })}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
