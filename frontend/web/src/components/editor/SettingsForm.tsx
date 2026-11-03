"use client";

import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { SettingsSchema, SettingsValues } from "@/templates/settings-schema";
import { OptionSelect } from "./OptionSelect";

/**
 * spec: TPL-004, EDI-007. The form of a template's settings, generated from its schema: one control per
 * kind of field, labelled by the schema's message keys. It knows no template.
 */
export function SettingsForm({
  schema,
  value,
  onChange,
}: {
  schema: SettingsSchema;
  /** Every setting, defaults included (`parseSettings`). */
  value: SettingsValues;
  onChange: (key: string, value: string | number | boolean) => void;
}) {
  const t = useTranslations();

  return (
    <div className="space-y-4">
      {schema.fields.map((field) => {
        const id = `setting-${field.key}`;
        const current = value[field.key];
        switch (field.kind) {
          case "select":
            return (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={id}>{t(field.labelKey)}</Label>
                <OptionSelect
                  id={id}
                  testId={id}
                  value={String(current)}
                  options={field.options.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                  onValueChange={(next) => onChange(field.key, next)}
                />
              </div>
            );
          case "boolean":
            return (
              <div key={field.key} className="flex items-center gap-3">
                <Switch
                  id={id}
                  data-testid={id}
                  checked={current === true}
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
