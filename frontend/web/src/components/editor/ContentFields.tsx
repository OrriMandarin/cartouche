"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CardDraft, ContentField } from "@/lib/cards/draft";
import { describedBy, FieldMessage } from "./Field";

type Control = { field: ContentField; type?: "email" | "tel"; multiline?: boolean };

const CONTROLS: Control[] = [
  { field: "first_name" },
  { field: "last_name" },
  { field: "job_title" },
  { field: "company" },
  { field: "description", multiline: true },
  { field: "email", type: "email" },
  { field: "phone", type: "tel" },
];

/** spec: EDI-007. Name, job, company, description and contact details of the card. */
export function ContentFields({
  value,
  onChange,
  errors,
}: {
  value: CardDraft["content"];
  onChange: (field: ContentField, text: string) => void;
  /** Translated messages by field path. */
  errors: Record<string, string>;
}) {
  const t = useTranslations("editor.content");

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {CONTROLS.map(({ field, type, multiline }) => {
        const path = `content.${field}`;
        const error = errors[path];
        const shared = {
          id: `editor-${field}`,
          "data-testid": `editor-${field}`,
          value: value[field],
          autoComplete: "off",
          "aria-invalid": error ? true : undefined,
          "aria-describedby": describedBy(path, error),
        };
        return (
          <div key={field} className={`space-y-2 ${multiline ? "sm:col-span-2" : ""}`}>
            <Label htmlFor={shared.id}>{t(field)}</Label>
            {multiline ? (
              <Textarea {...shared} rows={4} onChange={(event) => onChange(field, event.target.value)} />
            ) : (
              <Input
                {...shared}
                {...(type ? { type } : {})}
                onChange={(event) => onChange(field, event.target.value)}
              />
            )}
            <FieldMessage path={path} message={error} />
          </div>
        );
      })}
    </div>
  );
}
