"use client";

import { useTranslations } from "next-intl";
import { describedBy, FieldMessage } from "@/components/editor/Field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
    <div className="flex flex-col gap-2">
      <div>
        {STANDARD_FIELDS.map((field) => (
          <div
            key={field}
            className="border-app-border grid min-h-[60px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t @max-[847px]:grid-cols-1 @max-[847px]:gap-1.5 @max-[847px]:py-2.5"
          >
            <span id={`standard-label-${field}`} className="font-semibold">
              {t(`labels.${field}`)}
            </span>
            <RadioGroup
              aria-labelledby={`standard-label-${field}`}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy("standard_fields", error)}
              data-testid={`standard-field-${field}`}
              value={value[field]}
              onValueChange={(mode) => onChange(field, mode as FieldMode)}
              className="@max-[847px]:flex"
            >
              {FIELD_MODES.map((mode) => (
                <RadioGroupItem
                  key={mode}
                  value={mode}
                  data-testid={`standard-field-${field}-${mode}`}
                  className="@max-[847px]:flex-1 @max-[847px]:px-1.5 @max-[847px]:text-[13px]"
                >
                  {t(`modes.${mode}`)}
                </RadioGroupItem>
              ))}
            </RadioGroup>
          </div>
        ))}
      </div>
      <FieldMessage path="standard_fields" message={error} />
    </div>
  );
}
