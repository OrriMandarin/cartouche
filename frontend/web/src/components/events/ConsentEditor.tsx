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

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="consent-mode">{t("mode")}</Label>
        <OptionSelect
          id="consent-mode"
          testId="consent-mode"
          value={draft.consentMode}
          options={MODES.map((mode) => ({ value: mode, label: t(`modes.${mode}`) }))}
          onValueChange={(mode) => onChange({ consentMode: mode as EventDraft["consentMode"] })}
        />
      </div>

      {draft.consentMode === "default" ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">{t("defaultHint")}</p>
          <blockquote data-testid="consent-default-text" className="bg-muted/50 rounded-md border-l-4 p-3 text-sm">
            {preview.text ?? (preview.failed ? t("unavailable") : t("loading"))}
          </blockquote>
          {cardHasEmail(card.content) ? null : (
            <Alert data-testid="consent-no-email">
              <AlertDescription>{t("noEmail")}</AlertDescription>
            </Alert>
          )}
        </div>
      ) : (
        <div className="space-y-2">
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
          <p className="text-muted-foreground text-sm">{t("customHint")}</p>
        </div>
      )}
      <FieldMessage path="consent_text" message={error} />
    </div>
  );
}
