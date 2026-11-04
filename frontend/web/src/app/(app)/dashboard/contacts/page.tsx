"use client";

import { Calendar, Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AccountGate } from "@/components/account/AccountGate";
import { ErrorNotice } from "@/components/ErrorNotice";
import { CardSelect, ContactsHead, ScopeMenu, ScopeTabs } from "@/components/events/ContactsControls";
import { LeadList } from "@/components/events/LeadList";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api";
import type { CardView } from "@/lib/cards/types";
import { scopeTabs, selectedCard, selectedEventId } from "@/lib/events/contacts-scope";
import { ownerLeadActions } from "@/lib/events/lead-actions";
import type { EventView } from "@/lib/events/types";

function EmptyContacts({ cardId }: { cardId: string }) {
  const t = useTranslations("contactsPage.empty");
  return (
    <div
      data-testid="leads-empty"
      className="flex flex-1 flex-col items-center justify-center gap-3.5 px-3 py-6 text-center"
    >
      <div className="bg-app-surface-2 text-app-muted grid size-[72px] place-items-center rounded-full">
        <Inbox aria-hidden="true" className="size-[30px]" />
      </div>
      <h2 className="font-app-display text-[26px] leading-[1.15] font-semibold">{t("title")}</h2>
      <p className="text-app-muted max-w-[52ch]">{t("text")}</p>
      <Button asChild variant="secondary" className="mt-1.5 @max-[847px]:w-full">
        <Link href={`/dashboard/cards/${cardId}/events`} data-testid="contacts-events-link">
          <Calendar aria-hidden="true" />
          {t("link")}
        </Link>
      </Button>
    </div>
  );
}

/** The contacts of the card and the scope chosen in the address: its events are known, the list loads its contacts. */
function CardContacts({ cards, card, events }: { cards: CardView[]; card: CardView; events: EventView[] }) {
  const api = useApi();
  const requestedEvent = useSearchParams().get("event");
  const eventId = selectedEventId(events, requestedEvent);
  const eventTitle = events.find((event) => event.id === eventId)?.title ?? null;
  const load = useCallback(async () => {
    const { data } = await api.GET("/api/cards/{id}/leads", { params: { path: { id: card.id } } });
    if (!data) throw new Error("empty response");
    return data.leads;
  }, [api, card.id]);
  const actions = useMemo(() => ownerLeadActions(api), [api]);

  return (
    <LeadList
      key={card.id}
      load={load}
      actions={actions}
      showEvent={eventId === null}
      eventId={eventId}
      toolbar={(leads) => <ContactsHead card={card} eventId={eventId} eventTitle={eventTitle} leads={leads} />}
      controls={(leads) => (
        <>
          <CardSelect cards={cards} card={card} />
          {leads !== null && leads.length > 0 ? (
            <ScopeMenu cardId={card.id} tabs={scopeTabs(events, leads)} eventId={eventId} />
          ) : null}
        </>
      )}
      scopeBar={(leads) => <ScopeTabs cardId={card.id} tabs={scopeTabs(events, leads)} eventId={eventId} />}
      empty={<EmptyContacts cardId={card.id} />}
    />
  );
}

function ContactsContent() {
  const t = useTranslations("contactsPage");
  const api = useApi();
  const requestedCard = useSearchParams().get("card");
  const [cards, setCards] = useState<CardView[] | null>(null);
  const [events, setEvents] = useState<{ cardId: string; events: EventView[] } | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await api.GET("/api/cards");
        if (!data) throw new Error("empty response");
        setCards(data.cards);
      } catch (e) {
        setError(e);
      }
    })();
  }, [api]);

  const card = cards === null ? null : selectedCard(cards, requestedCard);
  const cardId = card?.id;

  useEffect(() => {
    if (cardId === undefined) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await api.GET("/api/cards/{id}/events", { params: { path: { id: cardId } } });
        if (!data) throw new Error("empty response");
        if (!cancelled) setEvents({ cardId, events: data.events });
      } catch (e) {
        if (!cancelled) setError(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, cardId]);

  if (error !== null) return <ErrorNotice error={error} />;
  if (cards === null) {
    return (
      <p data-testid="contacts-loading" className="text-app-muted py-6 text-center">
        {t("loading")}
      </p>
    );
  }
  if (card === null) {
    return (
      <p data-testid="contacts-no-cards" className="text-app-muted py-6 text-center">
        {t("noCards")}
      </p>
    );
  }
  if (events === null || events.cardId !== card.id) {
    return (
      <p data-testid="contacts-loading" className="text-app-muted py-6 text-center">
        {t("loading")}
      </p>
    );
  }
  return <CardContacts cards={cards} card={card} events={events.events} />;
}

/** spec: EDI-031, LEA-001, LEA-034, LEA-035. The contacts of the signed-in user: pick a card, then the whole card or one event. */
export default function ContactsPage() {
  const t = useTranslations("shell");
  return (
    <AccountGate title={t("contacts")}>
      <Suspense>
        <ContactsContent />
      </Suspense>
    </AccountGate>
  );
}
