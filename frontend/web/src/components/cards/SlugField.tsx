"use client";

import { AlertCircle, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { fieldErrorId, FieldMessage } from "@/components/editor/Field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugMessageKey, type SlugCheck } from "@/lib/cards/slug-availability";

const STATUS_STYLE: Record<SlugCheck["status"], string> = {
  idle: "",
  checking: "text-app-muted",
  free: "text-app-success",
  current: "text-app-success",
  taken: "text-app-danger",
  reserved: "text-app-danger",
  invalid: "text-app-danger",
};

const OK_STATUSES: SlugCheck["status"][] = ["free", "current"];
const REFUSED_STATUSES: SlugCheck["status"][] = ["taken", "reserved", "invalid"];

/**
 * spec: LNK-020, LNK-035. Slug input that tells, as the user types, whether the slug is free, taken,
 * reserved or invalid, and offers the available alternatives of a taken one. The owner of the field
 * gets `status` and `suggestions` from `useSlugAvailability(value)`, so it can also gate its submit
 * button on them.
 */
export function SlugField({
  value,
  onChange,
  status,
  suggestions = [],
  prefix,
  hint,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  status: SlugCheck["status"];
  /** Available slugs offered when the entered one is taken (LNK-035); clicking one fills the field. */
  suggestions?: string[] | undefined;
  /** Fixed part of the address shown before the editable slug (`host/c/`). */
  prefix?: ReactNode;
  /** Help text under the label. */
  hint?: ReactNode;
  /** Message of a slug the server refused on save (EDI-015), shown under the status. */
  error?: string | undefined;
}) {
  const t = useTranslations("cards.slug");
  const refused = REFUSED_STATUSES.includes(status);
  const messageKey = slugMessageKey({ status, suggestions });
  const describedBy = [hint ? "slug-hint" : null, "slug-status", error ? fieldErrorId("slug") : null].filter(Boolean).join(" ");

  return (
    <div className="space-y-2">
      <Label htmlFor="slug-input">{t("label")}</Label>
      {hint ? (
        <p id="slug-hint" className="text-app-muted text-sm">
          {hint}
        </p>
      ) : null}
      <div
        className={`flex items-stretch rounded-app ${refused || error ? "border-app-danger border-2" : "border-app-border-strong border"}`}
      >
        {prefix ? (
          <span className="bg-app-surface-2 text-app-muted border-app-border flex items-center rounded-l-[calc(var(--app-radius)-1px)] border-r pr-2.5 pl-3 text-sm whitespace-nowrap">
            {prefix}
          </span>
        ) : null}
        <Input
          id="slug-input"
          data-testid="slug-input"
          className="font-app-mono rounded-app border-0 text-sm aria-invalid:border-0 aria-invalid:px-3 aria-invalid:py-2.5"
          value={value}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={refused || Boolean(error)}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <p
        id="slug-status"
        data-testid="slug-status"
        data-status={status}
        role="status"
        className={`flex min-h-5 items-start gap-1.5 text-[13px] leading-[1.4] font-semibold ${STATUS_STYLE[status]}`}
      >
        {messageKey && OK_STATUSES.includes(status) ? <Check aria-hidden className="mt-px size-4 shrink-0" /> : null}
        {messageKey && refused ? <AlertCircle aria-hidden className="mt-px size-4 shrink-0" /> : null}
        {messageKey ? t(messageKey) : null}
      </p>
      {(status === "taken" || status === "reserved") && suggestions.length > 0 ? (
        <div role="group" aria-label={t("suggestionsLabel")} className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              data-testid={`slug-suggestion-${suggestion}`}
              className="bg-app-surface border-app-border text-app-text font-app-mono hover:bg-app-surface-2 inline-flex min-h-11 items-center rounded-full border px-3.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-ring)]"
              onClick={() => onChange(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
      <FieldMessage path="slug" message={error} />
    </div>
  );
}
