"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { ThemeSettings } from "@/lib/theme/presets";
import { resolveTheme } from "@/lib/theme/resolve";
import { getTemplate, listTemplates, type AnyTemplate } from "@/templates/registry";

/** A miniature of the card in the owner's theme: the header in the accent colour on the background. */
function Miniature({ theme }: { theme: ThemeSettings }) {
  const { background, accent } = resolveTheme(theme);
  return (
    <span
      aria-hidden="true"
      style={{
        background:
          background.kind === "solid"
            ? background.color
            : `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})`,
      }}
      className="flex h-[70px] w-[52px] flex-none flex-col overflow-hidden rounded-lg shadow-[0_0_0_1px_rgb(28_27_25/0.12)]"
    >
      <span style={{ background: accent }} className="block h-[30px] opacity-80" />
    </span>
  );
}

/**
 * spec: TPL-005, TPL-006, TPL-007. Every template, for everyone, as a card with its description; a template
 * in test carries a « bêta » badge.
 */
export function TemplatePicker({
  value,
  onChange,
  theme = { preset: "craie" },
  templates = listTemplates(),
}: {
  /** Id of the card's template; an unknown one counts as the fallback template, as at render time (TPL-015). */
  value: string;
  onChange: (id: string) => void;
  /** The card's theme, for the miniature of each template. */
  theme?: ThemeSettings;
  templates?: AnyTemplate[];
}) {
  const t = useTranslations();
  const selected = templates.some((template) => template.id === value) ? value : getTemplate(value).id;

  return (
    <div role="radiogroup" aria-label={t("editor.sections.template")} className="flex flex-col gap-2.5">
      {templates.map((template) => (
        <label
          key={template.id}
          data-testid={`template-option-${template.id}`}
          className="has-[:checked]:border-app-text border-app-border rounded-app has-[:focus-visible]:outline-[var(--app-ring)] flex cursor-pointer items-center gap-4 border-2 p-3.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-45"
        >
          <input
            type="radio"
            name="template"
            value={template.id}
            checked={selected === template.id}
            onChange={() => onChange(template.id)}
            className="sr-only"
          />
          <Miniature theme={theme} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-2 font-semibold">
              {t(template.nameKey)}
              {template.beta ? (
                <Badge variant="info" data-testid={`template-beta-${template.id}`}>
                  {t("editor.template.beta")}
                </Badge>
              ) : null}
            </span>
            <span className="text-app-muted text-[13px] leading-[1.4]">{t(template.descriptionKey)}</span>
          </span>
          {selected === template.id ? (
            <span
              aria-hidden="true"
              className="bg-app-primary text-app-on-primary grid size-6 flex-none place-items-center rounded-full"
            >
              <Check className="size-4" />
            </span>
          ) : null}
        </label>
      ))}
    </div>
  );
}
