"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CardDraft, ContentField } from "@/lib/cards/draft";
import { describedBy, FieldMessage } from "./Field";

type Control = { type?: "email" | "tel"; multiline?: boolean; optional?: boolean; hint?: boolean };

const CONTROLS: Record<ContentField, Control> = {
  first_name: {},
  last_name: {},
  job_title: { optional: true },
  company: { optional: true },
  description: { multiline: true, optional: true, hint: true },
  email: { type: "email", optional: true },
  phone: { type: "tel", optional: true },
};

/** spec: EDI-007. Some of the card's texts: name, job, company and description, or the contact details. */
export function ContentFields({
  fields,
  value,
  onChange,
  errors,
}: {
  /** The fields to show, in this order. */
  fields: readonly ContentField[];
  value: CardDraft["content"];
  onChange: (field: ContentField, text: string) => void;
  /** Translated messages by field path. */
  errors: Record<string, string>;
}) {
  const t = useTranslations("editor");

  return (
    <div className="grid gap-4 @min-[848px]:grid-cols-2">
      {fields.map((field) => {
        const { type, multiline, optional, hint } = CONTROLS[field];
        const path = `content.${field}`;
        const error = errors[path];
        const hintId = hint ? `editor-${field}-hint` : undefined;
        const shared = {
          id: `editor-${field}`,
          "data-testid": `editor-${field}`,
          value: value[field],
          autoComplete: "off",
          "aria-invalid": error ? true : undefined,
          "aria-describedby": describedBy(path, error, hintId),
        };
        return (
          <div key={field} className={`flex min-w-0 flex-col gap-1.5 ${multiline ? "@min-[848px]:col-span-2" : ""}`}>
            <Label htmlFor={shared.id}>
              {t(`content.${field}`)}
              {optional ? " " : null}
              {optional ? <span className="text-app-muted font-normal">{t("optional")}</span> : null}
            </Label>
            {multiline ? (
              <Textarea {...shared} rows={3} onChange={(event) => onChange(field, event.target.value)} />
            ) : (
              <Input
                {...shared}
                {...(type ? { type } : {})}
                onChange={(event) => onChange(field, event.target.value)}
              />
            )}
            {hintId ? (
              <p id={hintId} className="text-app-muted text-[13px] leading-[1.4]">
                {t(`hints.${field}`)}
              </p>
            ) : null}
            <FieldMessage path={path} message={error} />
          </div>
        );
      })}
    </div>
  );
}
