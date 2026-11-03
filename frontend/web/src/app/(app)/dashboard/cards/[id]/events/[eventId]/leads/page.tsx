"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AccountGate } from "@/components/account/AccountGate";
import { CardScope } from "@/components/events/CardScope";
import { EventScope } from "@/components/events/EventScope";
import { LeadList } from "@/components/events/LeadList";

function LeadsHeader({ cardId, title }: { cardId: string; title: string }) {
  const t = useTranslations();

  return (
    <header className="space-y-2">
      <Link href={`/dashboard/cards/${cardId}/events`} data-testid="leads-back" className="text-sm underline">
        {t("events.backToEvents")}
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">{t("leads.title")}</h1>
      <p data-testid="leads-event-title" className="text-muted-foreground">
        {title}
      </p>
    </header>
  );
}

/** spec: EDI-020. The contacts of one event of one card of the signed-in user. */
export default function EventLeadsPage() {
  const { id, eventId } = useParams<{ id: string; eventId: string }>();

  return (
    <AccountGate>
      <CardScope cardId={id}>
        {(card) => (
          <EventScope card={card} eventId={eventId}>
            {(event) => (
              <section className="space-y-6">
                <LeadsHeader cardId={card.id} title={event.title} />
                <LeadList eventId={event.id} />
              </section>
            )}
          </EventScope>
        )}
      </CardScope>
    </AccountGate>
  );
}
