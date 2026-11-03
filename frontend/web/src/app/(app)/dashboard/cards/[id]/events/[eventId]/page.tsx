"use client";

import { ApiError } from "@cartouche/api-client";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AccountGate } from "@/components/account/AccountGate";
import { CardScope } from "@/components/events/CardScope";
import { EventEditor } from "@/components/events/EventEditor";
import { ErrorNotice } from "@/components/ErrorNotice";
import { useApi } from "@/lib/api";
import type { CardView } from "@/lib/cards/types";
import type { EventView } from "@/lib/events/types";

type State =
  | { kind: "loading" }
  | { kind: "ready"; event: EventView }
  | { kind: "not-found" }
  | { kind: "error"; error: unknown };

function EventLoader({ card, eventId }: { card: CardView; eventId: string }) {
  const t = useTranslations("events");
  const api = useApi();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let next: State;
      try {
        const { data } = await api.GET("/api/events/{id}", { params: { path: { id: eventId } } });
        // An event of another card is not reachable from this one.
        next =
          data && data.card_id === card.id
            ? { kind: "ready", event: data }
            : data
              ? { kind: "not-found" }
              : { kind: "error", error: new Error("empty response") };
      } catch (error) {
        next = error instanceof ApiError && error.status === 404 ? { kind: "not-found" } : { kind: "error", error };
      }
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, card.id, eventId]);

  switch (state.kind) {
    case "loading":
      return (
        <p data-testid="events-loading" className="text-muted-foreground py-6 text-center">
          {t("loading")}
        </p>
      );
    case "not-found":
      return (
        <p data-testid="event-not-found" className="text-muted-foreground py-10 text-center text-lg">
          {t("notFound")}
        </p>
      );
    case "error":
      return <ErrorNotice error={state.error} />;
    case "ready":
      return <EventEditor cardId={card.id} card={card} event={state.event} />;
  }
}

/** spec: EDI-019, EVT-009. The editor of one event of one card of the signed-in user. */
export default function EditEventPage() {
  const { id, eventId } = useParams<{ id: string; eventId: string }>();

  return (
    <AccountGate>
      <CardScope cardId={id}>{(card) => <EventLoader card={card} eventId={eventId} />}</CardScope>
    </AccountGate>
  );
}
