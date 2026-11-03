"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { getTemplate, listTemplates, type AnyTemplate } from "@/templates/registry";

/** spec: TPL-005, TPL-006, TPL-007. Every template, for everyone; a template in test carries a « bêta » badge. */
export function TemplatePicker({
  value,
  onChange,
  templates = listTemplates(),
}: {
  /** Id of the card's template; an unknown one counts as the fallback template, as at render time (TPL-015). */
  value: string;
  onChange: (id: string) => void;
  templates?: AnyTemplate[];
}) {
  const t = useTranslations();
  const selected = templates.some((template) => template.id === value) ? value : getTemplate(value).id;

  return (
    <div role="radiogroup" aria-label={t("editor.sections.template")} className="grid gap-2 sm:grid-cols-2">
      {templates.map((template) => (
        <label
          key={template.id}
          data-testid={`template-option-${template.id}`}
          className="has-[:checked]:border-primary has-[:focus-visible]:ring-ring/50 flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-[:focus-visible]:ring-[3px]"
        >
          <input
            type="radio"
            name="template"
            value={template.id}
            checked={selected === template.id}
            onChange={() => onChange(template.id)}
          />
          <span className="font-medium">{t(template.nameKey)}</span>
          {template.beta ? (
            <Badge variant="secondary" data-testid={`template-beta-${template.id}`}>
              {t("editor.template.beta")}
            </Badge>
          ) : null}
        </label>
      ))}
    </div>
  );
}
