"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountGate, useMe } from "@/components/account/AccountGate";
import { ErrorNotice } from "@/components/ErrorNotice";
import { CardScope } from "@/components/events/CardScope";
import { EventList } from "@/components/events/EventList";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api";
import type { CardView } from "@/lib/cards/types";
import { userTimeZone, zoneLabel } from "@/lib/events/time";
import type { EventView } from "@/lib/events/types";

function EventsContent({ card }: { card: CardView }) {
  const t = useTranslations("events");
  const me = useMe();
  const api = useApi();
  const newEventHref = `/dashboard/cards/${card.id}/events/new`;
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
    <section className="flex flex-1 flex-col gap-6 @max-[847px]:gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-[28px] leading-[1.2] font-bold tracking-[-0.02em] @max-[847px]:sr-only">{t("title")}</h1>
          <p data-testid="events-card-name" className="text-app-muted">
            {t("subtitle", { slug: card.slug, zone: zoneLabel(userTimeZone()) })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="secondary">
            <Link href={`/dashboard/cards/${card.id}/leads`} data-testid="card-leads-link">
              {t("allLeads")}
            </Link>
          </Button>
          <Button asChild className="@max-[847px]:hidden">
            <Link href={newEventHref} data-testid="new-event">
              <Plus aria-hidden="true" />
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
        <EventList events={events} max={me.max_simultaneous_events} newEventHref={newEventHref} onChanged={reload} />
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
      back={{ href: `/dashboard/cards/${id}`, label: t("events.backToCard") }}
      action={
        <Link
          href={`/dashboard/cards/${id}/events/new`}
          aria-label={t("events.newEvent")}
          data-testid="new-event-bar"
          className="rounded-app focus-visible:outline-app-primary grid size-11 flex-none place-items-center focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Plus aria-hidden="true" className="size-5" />
        </Link>
      }
    >
      <CardScope cardId={id}>{(card) => <EventsContent card={card} />}</CardScope>
    </AccountGate>
  );
}
