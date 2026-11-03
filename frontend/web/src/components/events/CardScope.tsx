"use client";

import { ApiError } from "@cartouche/api-client";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import { useApi } from "@/lib/api";
import type { CardView } from "@/lib/cards/types";

type State =
  | { kind: "loading" }
  | { kind: "ready"; card: CardView }
  | { kind: "not-found" }
  | { kind: "error"; error: unknown };

/**
 * spec: ACC-017, EVT-025. Loads the card of the signed-in user the events pages belong to, whatever its status
 * (a disabled card keeps its events); a card that does not exist and the card of someone else look the same.
 */
export function CardScope({ cardId, children }: { cardId: string; children: (card: CardView) => ReactNode }) {
  const t = useTranslations();
  const api = useApi();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let next: State;
      try {
        const { data } = await api.GET("/api/cards/{id}", { params: { path: { id: cardId } } });
        next = data ? { kind: "ready", card: data } : { kind: "error", error: new Error("empty response") };
      } catch (error) {
        next = error instanceof ApiError && error.status === 404 ? { kind: "not-found" } : { kind: "error", error };
      }
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, cardId]);

  switch (state.kind) {
    case "loading":
      return (
        <p data-testid="events-loading" className="text-muted-foreground py-6 text-center">
          {t("events.loading")}
        </p>
      );
    case "not-found":
      return (
        <p data-testid="card-not-found" className="text-muted-foreground py-10 text-center text-lg">
          {t("publicCard.notFound")}
        </p>
      );
    case "error":
      return <ErrorNotice error={state.error} />;
    case "ready":
      return <>{children(state.card)}</>;
  }
}
