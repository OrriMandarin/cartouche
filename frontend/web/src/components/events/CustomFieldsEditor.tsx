"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { describedBy, FieldMessage } from "@/components/editor/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  type EventDraft,
  addCustomField,
  addOption,
  moveCustomField,
  removeCustomField,
  removeOption,
  setOption,
  updateCustomField,
} from "@/lib/events/draft";
import { CUSTOM_FIELD_KINDS, MAX_CUSTOM_FIELDS, MAX_OPTIONS } from "@/lib/events/fields";

/**
 * spec: FRM-020, FRM-021, FRM-032. The custom fields of the form, in the order the owner chooses: added by
 * kind, with a label, a help text, a required switch and, for a single choice, its options.
 */
export function CustomFieldsEditor({
  draft,
  errors,
  onChange,
}: {
  draft: EventDraft;
  /** Translated messages by field path. */
  errors: Record<string, string>;
  /** `fixed` lists the field paths this change corrects, so their messages can go. */
  onChange: (draft: EventDraft, fixed: string[]) => void;
}) {
  const t = useTranslations("events.editor.custom");
  const fields = draft.customFields;
  const full = fields.length >= MAX_CUSTOM_FIELDS;

  return (
    <div className="space-y-4">
      {fields.length === 0 ? <p className="text-muted-foreground text-sm">{t("empty")}</p> : null}
      <FieldMessage path="custom_fields" message={errors.custom_fields} />
      <ul className="space-y-4">
        {fields.map((field, index) => {
          const n = index + 1;
          const path = `custom_fields[${index}]`;
          const labelPath = `${path}.label`;
          const helpPath = `${path}.help`;
          const optionsPath = `${path}.options`;
          return (
            <li
              key={field.id}
              data-testid={`custom-field-${index}`}
              className="bg-card space-y-3 rounded-lg border p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {t("item", { index: n })} <span className="text-muted-foreground">· {t(`kinds.${field.kind}`)}</span>
                </p>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-testid={`custom-up-${index}`}
                    aria-label={t("moveUp", { index: n })}
                    disabled={index === 0}
                    onClick={() => onChange(moveCustomField(draft, index, -1), ["custom_fields"])}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-testid={`custom-down-${index}`}
                    aria-label={t("moveDown", { index: n })}
                    disabled={index === fields.length - 1}
                    onClick={() => onChange(moveCustomField(draft, index, 1), ["custom_fields"])}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-testid={`custom-remove-${index}`}
                    aria-label={t("remove", { index: n })}
                    onClick={() => onChange(removeCustomField(draft, index), ["custom_fields"])}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`custom-label-${index}`}>{t("label")}</Label>
                <Input
                  id={`custom-label-${index}`}
                  data-testid={`custom-label-${index}`}
                  autoComplete="off"
                  value={field.label}
                  aria-invalid={errors[labelPath] ? true : undefined}
                  aria-describedby={describedBy(labelPath, errors[labelPath])}
                  onChange={(e) => onChange(updateCustomField(draft, index, { label: e.target.value }), [labelPath])}
                />
                <FieldMessage path={labelPath} message={errors[labelPath]} />
              </div>

              <div className="space-y-2">
                <Label htmlFor={`custom-help-${index}`}>{t("help")}</Label>
                <Input
                  id={`custom-help-${index}`}
                  data-testid={`custom-help-${index}`}
                  autoComplete="off"
                  value={field.help}
                  aria-invalid={errors[helpPath] ? true : undefined}
                  aria-describedby={describedBy(helpPath, errors[helpPath])}
                  onChange={(e) => onChange(updateCustomField(draft, index, { help: e.target.value }), [helpPath])}
                />
                <FieldMessage path={helpPath} message={errors[helpPath]} />
              </div>

              <div className="flex items-center gap-3">
                <Switch
                  id={`custom-required-${index}`}
                  data-testid={`custom-required-${index}`}
                  checked={field.required}
                  onCheckedChange={(required) => onChange(updateCustomField(draft, index, { required }), [])}
                />
                <Label htmlFor={`custom-required-${index}`}>{t("required")}</Label>
              </div>

              {field.kind === "single_choice" ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium">{t("options")}</p>
                  <FieldMessage path={optionsPath} message={errors[optionsPath]} />
                  <ul className="space-y-2">
                    {field.options.map((option, position) => {
                      const optionPath = `${optionsPath}[${position}]`;
                      return (
                        <li key={position} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Input
                              data-testid={`custom-option-${index}-${position}`}
                              aria-label={t("option", { index: position + 1 })}
                              autoComplete="off"
                              value={option}
                              aria-invalid={errors[optionPath] ? true : undefined}
                              aria-describedby={describedBy(optionPath, errors[optionPath])}
                              onChange={(e) =>
                                onChange(setOption(draft, index, position, e.target.value), [optionsPath])
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              data-testid={`custom-option-remove-${index}-${position}`}
                              aria-label={t("removeOption", { index: position + 1 })}
                              onClick={() => onChange(removeOption(draft, index, position), [optionsPath])}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                          <FieldMessage path={optionPath} message={errors[optionPath]} />
                        </li>
                      );
                    })}
                  </ul>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid={`custom-option-add-${index}`}
                    disabled={field.options.length >= MAX_OPTIONS}
                    onClick={() => onChange(addOption(draft, index), [optionsPath])}
                  >
                    <Plus />
                    {t("addOption")}
                  </Button>
                </div>
              ) : null}
              <FieldMessage path={`${path}.id`} message={errors[`${path}.id`]} />
            </li>
          );
        })}
      </ul>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("addHint")}</p>
        <div className="flex flex-wrap gap-2">
          {CUSTOM_FIELD_KINDS.map((kind) => (
            <Button
              key={kind}
              type="button"
              variant="outline"
              size="sm"
              data-testid={`custom-add-${kind}`}
              disabled={full}
              onClick={() => onChange(addCustomField(draft, kind), ["custom_fields"])}
            >
              <Plus />
              {t("add", { kind: t(`kinds.${kind}`) })}
            </Button>
          ))}
        </div>
        {full ? <p className="text-muted-foreground text-sm">{t("max")}</p> : null}
      </div>
    </div>
  );
}
