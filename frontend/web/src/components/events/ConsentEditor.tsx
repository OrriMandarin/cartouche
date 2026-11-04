"use client";

import { useTranslations } from "next-intl";
import { describedBy, FieldMessage } from "@/components/editor/Field";
import { OptionSelect } from "@/components/editor/OptionSelect";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cardHasEmail, useConsentPreview } from "@/lib/events/consent";
import type { EventDraft } from "@/lib/events/draft";
import type { CardView } from "@/lib/cards/types";

const MODES = ["default", "custom"] as const;

/**
 * spec: FRM-007, FRM-028, FRM-029. The consent text of the event: the default one, shown as the prospect will
 * read it (composed by the server, with a warning when the card has no email), or the owner's own.
 */
export function ConsentEditor({
  cardId,
  card,
  draft,
  knownDefault,
  error,
  onChange,
}: {
  cardId: string;
  card: Pick<CardView, "content">;
  draft: EventDraft;
  /** The default text the server already gave, with the title it was composed for. */
  knownDefault?: { title: string; text: string };
  /** Translated message of `consent_text`. */
  error: string | undefined;
  onChange: (patch: Pick<EventDraft, "consentMode"> | Pick<EventDraft, "consentText">) => void;
}) {
  const t = useTranslations("events.editor.consent");
  const preview = useConsentPreview(cardId, draft.title, knownDefault);

  const text =
    draft.consentMode === "default"
      ? (preview.text ?? (preview.failed ? t("unavailable") : t("loading")))
      : draft.consentText.trim();

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label={t("preview")}
        data-testid="consent-preview"
        className="bg-app-surface-2 rounded-app-lg flex items-start gap-3 p-4 text-[15px] leading-[1.45]"
      >
        <span
          aria-hidden="true"
          className="border-app-border-strong bg-app-surface mt-px size-[22px] flex-none rounded-[5px] border-2"
        />
        <span data-testid={draft.consentMode === "default" ? "consent-default-text" : "consent-custom-text"}>
          {text}
        </span>
      </div>
      <p className="text-app-muted text-[13px] leading-[1.4]">{t("always")}</p>

      {draft.consentMode === "default" && !cardHasEmail(card.content) ? (
        <Alert data-testid="consent-no-email">
          <AlertDescription>{t("noEmail")}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="consent-mode">{t("mode")}</Label>
        <OptionSelect
          id="consent-mode"
          testId="consent-mode"
          value={draft.consentMode}
          options={MODES.map((mode) => ({ value: mode, label: t(`modes.${mode}`) }))}
          onValueChange={(mode) => onChange({ consentMode: mode as EventDraft["consentMode"] })}
        />
      </div>

      {draft.consentMode === "custom" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="consent-text">{t("custom")}</Label>
          <Textarea
            id="consent-text"
            data-testid="consent-text"
            rows={5}
            value={draft.consentText}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy("consent_text", error)}
            onChange={(e) => onChange({ consentText: e.target.value })}
          />
          <p className="text-app-muted text-[13px] leading-[1.4]">{t("customHint")}</p>
        </div>
      ) : null}
      <FieldMessage path="consent_text" message={error} />
    </div>
  );
}
