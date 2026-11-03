"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/api";

/** Pause after the last keystroke in the title before asking the server for the text. */
export const CONSENT_PREVIEW_DELAY_MS = 300;

/** Whether a card gives an email, which the default consent text points prospects to (FRM-027, FRM-029). */
export function cardHasEmail(content: { email?: string | null }): boolean {
  return (content.email ?? "").trim() !== "";
}

export interface ConsentPreview {
  /** The default consent text; `null` until the server has given it. */
  text: string | null;
  /** The server could not give it. */
  failed: boolean;
}

interface Answer {
  title: string;
  text: string | null;
}

/**
 * spec: FRM-029. The default consent text of the card for this event title, as the server composes it
 * (R-PF6: the text is never rebuilt in the browser). Asks 300 ms after the last change of the title,
 * ignores the answer to an outdated title and keeps the last text on screen meanwhile. `known` is the
 * text the server already gave for a title (the stored event), shown without asking again.
 */
export function useConsentPreview(cardId: string, title: string, known?: { title: string; text: string }): ConsentPreview {
  const api = useApi();
  const [answer, setAnswer] = useState<Answer | null>(known ? { title: known.title, text: known.text } : null);
  const upToDate = answer !== null && answer.title === title;

  useEffect(() => {
    if (upToDate) return;
    let stale = false;
    const timer = setTimeout(() => {
      void (async () => {
        let text: string | null;
        try {
          const { data } = await api.POST("/api/cards/{id}/consent-preview", {
            params: { path: { id: cardId } },
            body: { title },
          });
          text = data?.text ?? null;
        } catch {
          text = null;
        }
        if (!stale) setAnswer({ title, text });
      })();
    }, CONSENT_PREVIEW_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [api, cardId, title, upToDate]);

  const failed = upToDate && answer.text === null;
  return { text: answer?.text ?? null, failed };
}
