"use client";

import { useTranslations } from "next-intl";
import { describedBy, FieldMessage } from "@/components/editor/Field";
import { OptionSelect } from "@/components/editor/OptionSelect";
import { Label } from "@/components/ui/label";
import { FIELD_MODES, STANDARD_FIELDS } from "@/lib/events/fields";
import type { FieldMode, StandardFields } from "@/lib/events/types";

/** spec: FRM-017, FRM-019, FRM-031. The mode of each standard field: not asked, optional or required. */
export function StandardFieldsEditor({
  value,
  onChange,
  error,
}: {
  value: StandardFields;
  onChange: (field: keyof StandardFields, mode: FieldMode) => void;
  /** Translated message of `standard_fields` (a form with no field at all). */
  error: string | undefined;
}) {
  const t = useTranslations("events.editor.standard");

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{t("hint")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {STANDARD_FIELDS.map((field) => (
          <div key={field} className="space-y-2">
            <Label htmlFor={`standard-field-${field}`}>{t(`labels.${field}`)}</Label>
            <OptionSelect
              id={`standard-field-${field}`}
              testId={`standard-field-${field}`}
              value={value[field]}
              options={FIELD_MODES.map((mode) => ({ value: mode, label: t(`modes.${mode}`) }))}
              invalid={error ? true : undefined}
              describedBy={describedBy("standard_fields", error)}
              onValueChange={(mode) => onChange(field, mode as FieldMode)}
            />
          </div>
        ))}
      </div>
      <FieldMessage path="standard_fields" message={error} />
    </div>
  );
}
