"use client";

import { useTranslations } from "next-intl";
import { useMemo, type MouseEvent } from "react";
import { buildCardUrls } from "@/lib/card-urls";
import { PREVIEW_EVENT_ID, draftToPublicCard, type CardDraft } from "@/lib/cards/draft";
import { buildTemplateLabels, type PublicEvent } from "@/templates/contract";
import { renderTemplate } from "@/templates/registry";

const SCREEN = { width: 390, height: 844 };
// The phone of the design: a 340 px wide screen inside an 8 px bezel.
const SCALE = 340 / SCREEN.width;
const BEZEL = 8;
// The template only orders events by start; the simulated one has no real date.
const PREVIEW_EVENT_START = "2000-01-01T00:00:00Z";

/** The preview never navigates: a click on a link of the card does nothing (EDI-004). */
function blockLinks(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest("a")) event.preventDefault();
}

/**
 * spec: EDI-003, EDI-004, EDI-005, TPL-014. The card inside a phone frame (390 × 844, scaled down), rendered
 * with the same template as the public page. The simulated event exists here only (EDI-017).
 */
export function PhonePreview({
  draft,
  simulateEvent,
  publicBaseUrl,
}: {
  draft: CardDraft;
  simulateEvent: boolean;
  /** Address the card is served from, without `/c/{slug}`. */
  publicBaseUrl: string;
}) {
  const t = useTranslations();
  const card = useMemo(() => draftToPublicCard(draft, publicBaseUrl), [draft, publicBaseUrl]);
  const labels = useMemo(() => buildTemplateLabels(t), [t]);
  const eventTitle = t("editor.preview.event");
  const events = useMemo<PublicEvent[]>(
    () => (simulateEvent ? [{ id: PREVIEW_EVENT_ID, title: eventTitle, startsAt: PREVIEW_EVENT_START }] : []),
    [simulateEvent, eventTitle],
  );

  return (
    <div
      data-testid="phone-preview"
      role="group"
      aria-label={t("editor.preview.frame")}
      className="shadow-app mx-auto flex-none rounded-[44px] bg-app-text"
      style={{
        width: SCREEN.width * SCALE + BEZEL * 2,
        height: SCREEN.height * SCALE + BEZEL * 2,
        padding: BEZEL,
      }}
    >
      <div
        className="h-full w-full overflow-x-hidden overflow-y-auto rounded-[36px] bg-white"
        onClickCapture={blockLinks}
      >
        <div
          // The template fills a screen (`min-height: 100svh`); here the screen is the phone's.
          className="origin-top-left [&_article]:min-h-[844px]"
          style={{ width: SCREEN.width, transform: `scale(${SCALE})` }}
        >
          {renderTemplate({
            template: card.template,
            settings: card.settings,
            theme: card.theme,
            card,
            events,
            urls: buildCardUrls(card),
            labels,
            mode: "preview",
          })}
        </div>
      </div>
    </div>
  );
}
