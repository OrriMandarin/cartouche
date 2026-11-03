"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/api";
import { SLUG_CHECK_DELAY_MS } from "./slug-availability";

/**
 * spec: LNK-019. A free slug derived from a name, 300 ms after the last change; `null` while
 * unknown, when the name gives nothing usable or when the request fails (the field stays editable).
 */
export function useSlugSuggestion(firstName: string, lastName: string): string | null {
  const api = useApi();
  const first = firstName.trim();
  const last = lastName.trim();
  const [suggestion, setSuggestion] = useState<{ first: string; last: string; slug: string | null } | null>(null);

  useEffect(() => {
    if (first === "" && last === "") return;
    let stale = false;
    const timer = setTimeout(() => {
      void (async () => {
        let slug: string | null;
        try {
          const { data } = await api.GET("/api/slugs/suggestion", {
            params: { query: { first_name: first, last_name: last } },
          });
          slug = data?.slug ?? null;
        } catch {
          slug = null;
        }
        if (!stale) setSuggestion({ first, last, slug });
      })();
    }, SLUG_CHECK_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [api, first, last]);

  return suggestion?.first === first && suggestion.last === last ? suggestion.slug : null;
}
