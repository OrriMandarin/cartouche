"use client";

import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { SettingsSchema, SettingsValues } from "@/templates/settings-schema";
import { OptionSelect } from "./OptionSelect";
import { SegmentedSelect } from "./SegmentedSelect";

/** A select with at most this many options is shown as a segmented control (TPL-027). */
const MAX_SEGMENTED_OPTIONS = 3;

/**
 * spec: TPL-004, EDI-007. The form of a template's settings, generated from its schema: one control per
 * kind of field, labelled by the schema's message keys. It knows no template. A short select is a segmented
 * control. A read-only form (`disabled`) also disables the Radix sliders, which the fieldset around the form
 * does not reach.
 */
export function SettingsForm({
  schema,
  value,
  onChange,
  templateName,
  disabled,
}: {
  schema: SettingsSchema;
  /** Every setting, defaults included (`parseSettings`). */
  value: SettingsValues;
  onChange: (key: string, value: string | number | boolean) => void;
  /** When given, each label says it is a setting of that template. */
  templateName?: string;
  disabled?: boolean | undefined;
}) {
  const t = useTranslations();

  return (
    <div className="space-y-4">
      {schema.fields.map((field) => {
        const id = `setting-${field.key}`;
        const current = value[field.key];
        switch (field.kind) {
          case "select": {
            const options = field.options.map((option) => ({ value: option.value, label: t(option.labelKey) }));
            if (options.length <= MAX_SEGMENTED_OPTIONS) {
              return (
                <SegmentedSelect
                  key={field.key}
                  label={
                    <>
                      {t(field.labelKey)}
                      {templateName === undefined ? null : (
                        <>
                          {" "}
                          <span className="text-app-muted font-normal">
                            {t("editor.settings.ofTemplate", { name: templateName })}
                          </span>
                        </>
                      )}
                    </>
                  }
                  testId={id}
                  value={String(current)}
                  options={options}
                  onValueChange={(next) => onChange(field.key, next)}
                  disabled={disabled}
                />
              );
            }
            return (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={id}>{t(field.labelKey)}</Label>
                <OptionSelect
                  id={id}
                  testId={id}
                  value={String(current)}
                  options={options}
                  onValueChange={(next) => onChange(field.key, next)}
                  disabled={disabled}
                />
              </div>
            );
          }
          case "boolean":
            return (
              <div key={field.key} className="flex items-center gap-3">
                <Switch
                  id={id}
                  data-testid={id}
                  checked={current === true}
                  disabled={disabled}
                  onCheckedChange={(next) => onChange(field.key, next)}
                />
                <Label htmlFor={id}>{t(field.labelKey)}</Label>
              </div>
            );
          case "range":
            return (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={id}>
                  {t(field.labelKey)} <span className="text-muted-foreground">{String(current)}</span>
                </Label>
                <Slider
                  id={id}
                  data-testid={id}
                  aria-label={t(field.labelKey)}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  disabled={disabled}
                  value={[typeof current === "number" ? current : field.default]}
                  onValueChange={([next]) => {
                    if (next !== undefined) onChange(field.key, next);
                  }}
                />
              </div>
            );
          case "color":
            return (
              <div key={field.key} className="flex items-center gap-3">
                <input
                  id={id}
                  data-testid={id}
                  type="color"
                  disabled={disabled}
                  className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
                  value={typeof current === "string" ? current : field.default}
                  onChange={(event) => onChange(field.key, event.target.value)}
                />
                <Label htmlFor={id}>{t(field.labelKey)}</Label>
              </div>
            );
        }
      })}
    </div>
  );
}
