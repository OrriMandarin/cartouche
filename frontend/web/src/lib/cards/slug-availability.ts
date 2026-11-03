"use client";

import type { components } from "@cartouche/api-client";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/api";

type SlugAvailability = components["schemas"]["SlugAvailability"];

export interface SlugCheck {
  status: "idle" | "checking" | SlugAvailability["status"];
  /** The slug as the server normalized it; `null` until known or when it is invalid. */
  normalized: string | null;
}

const IDLE: SlugCheck = { status: "idle", normalized: null };
const CHECKING: SlugCheck = { status: "checking", normalized: null };

/** Pause after the last keystroke before asking the server. */
export const SLUG_CHECK_DELAY_MS = 300;

/**
 * spec: LNK-020. Live availability of a slug for a new card, or for the card `cardId` being edited.
 * Asks the server 300 ms after the last change and ignores the answer to an outdated slug.
 * If the check fails the field falls back to idle: the server still refuses a taken slug on save.
 */
export function useSlugAvailability(slug: string, cardId?: string): SlugCheck {
  const api = useApi();
  const trimmed = slug.trim();
  const [result, setResult] = useState<{ slug: string; cardId?: string; check: SlugCheck } | null>(null);

  useEffect(() => {
    if (trimmed === "") return;
    let stale = false;
    const timer = setTimeout(() => {
      void (async () => {
        let check: SlugCheck;
        try {
          const { data } = await api.GET("/api/slugs/availability", {
            params: { query: { slug: trimmed, ...(cardId ? { card_id: cardId } : {}) } },
          });
          check = data ? { status: data.status, normalized: data.slug ?? null } : IDLE;
        } catch {
          check = IDLE;
        }
        if (!stale) setResult({ slug: trimmed, ...(cardId ? { cardId } : {}), check });
      })();
    }, SLUG_CHECK_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [api, trimmed, cardId]);

  if (trimmed === "") return IDLE;
  // An answer only counts for the slug it was asked about.
  return result?.slug === trimmed && result.cardId === cardId ? result.check : CHECKING;
}
