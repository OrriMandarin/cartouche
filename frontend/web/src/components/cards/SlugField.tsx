"use client";

import { useTranslations } from "next-intl";
import { fieldErrorId, FieldMessage } from "@/components/editor/Field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SlugCheck } from "@/lib/cards/slug-availability";

const STATUS_STYLE: Record<SlugCheck["status"], string> = {
  idle: "",
  checking: "text-muted-foreground",
  free: "text-green-700 dark:text-green-400",
  current: "text-green-700 dark:text-green-400",
  taken: "text-destructive",
  reserved: "text-destructive",
  invalid: "text-destructive",
};

/**
 * spec: LNK-020. Slug input that tells, as the user types, whether the slug is free, taken, reserved
 * or invalid. The owner of the field gets `status` from `useSlugAvailability(value)`, so it can
 * also gate its submit button on it.
 */
export function SlugField({
  value,
  onChange,
  status,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  status: SlugCheck["status"];
  /** Message of a slug the server refused on save (EDI-015), shown under the status. */
  error?: string | undefined;
}) {
  const t = useTranslations("cards.slug");

  return (
    <div className="space-y-2">
      <Label htmlFor="slug-input">{t("label")}</Label>
      <Input
        id="slug-input"
        data-testid="slug-input"
        value={value}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={status === "taken" || status === "reserved" || status === "invalid" || Boolean(error)}
        aria-describedby={error ? `slug-status ${fieldErrorId("slug")}` : "slug-status"}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id="slug-status" data-testid="slug-status" data-status={status} role="status" className={`min-h-5 text-sm ${STATUS_STYLE[status]}`}>
        {status === "idle" ? null : t(status)}
      </p>
      <FieldMessage path="slug" message={error} />
    </div>
  );
}
