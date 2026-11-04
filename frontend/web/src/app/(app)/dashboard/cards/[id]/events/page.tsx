"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountGate } from "@/components/account/AccountGate";
import { ErrorNotice } from "@/components/ErrorNotice";
import { CardScope } from "@/components/events/CardScope";
import { EventList } from "@/components/events/EventList";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api";
import { cardDisplayName } from "@/lib/cards/display-name";
import type { CardView } from "@/lib/cards/types";
import type { EventView } from "@/lib/events/types";

function EventsContent({ card }: { card: CardView }) {
  const t = useTranslations("events");
  const api = useApi();
  const [events, setEvents] = useState<EventView[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const latestRequest = useRef(0);

  // Resolves once the list is reloaded (never rejects), so the actions can wait for it.
  const reload = useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const { data } = await api.GET("/api/cards/{id}/events", { params: { path: { id: card.id } } });
      if (!data) throw new Error("empty response");
      if (request !== latestRequest.current) return; // a newer reload superseded this one
      setEvents(data.events);
      setError(null);
    } catch (e) {
      if (request === latestRequest.current) setError(e);
    }
  }, [api, card.id]);

  useEffect(() => {
    void (async () => {
      await reload();
    })();
  }, [reload]);

  return (
    <section className="space-y-6">
      <Link href="/dashboard" data-testid="events-back" className="text-sm underline">
        {t("backToDashboard")}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
          <p data-testid="events-card-name" className="text-muted-foreground">
            {cardDisplayName(card.content) ?? card.slug}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href={`/dashboard/cards/${card.id}/leads`} data-testid="card-leads-link">
              {t("allLeads")}
            </Link>
          </Button>
          <Button asChild>
            <Link href={`/dashboard/cards/${card.id}/events/new`} data-testid="new-event">
              {t("newEvent")}
            </Link>
          </Button>
        </div>
      </div>
      {error !== null ? <ErrorNotice error={error} /> : null}
      {events === null ? (
        error === null ? (
          <p data-testid="events-loading" className="text-muted-foreground py-6 text-center">
            {t("loading")}
          </p>
        ) : null
      ) : (
        <EventList events={events} onChanged={reload} />
      )}
    </section>
  );
}

/** spec: EDI-009, EDI-010, EDI-018, EVT-025, LEA-013. The events of one card of the signed-in user, in three groups. */
export default function CardEventsPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations();

  return (
    <AccountGate
      title={t("events.title")}
      breadcrumb={[{ label: t("shell.cards"), href: "/dashboard" }, { label: t("events.title") }]}
      back={{ href: "/dashboard", label: t("shell.cards") }}
    >
      <CardScope cardId={id}>{(card) => <EventsContent card={card} />}</CardScope>
    </AccountGate>
  );
}
