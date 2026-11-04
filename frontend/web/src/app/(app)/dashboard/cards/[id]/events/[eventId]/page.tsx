"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AccountGate } from "@/components/account/AccountGate";
import { CardScope } from "@/components/events/CardScope";
import { EventEditor } from "@/components/events/EventEditor";
import { EventScope } from "@/components/events/EventScope";

/** spec: EDI-019, EVT-009. The editor of one event of one card of the signed-in user. */
export default function EditEventPage() {
  const { id, eventId } = useParams<{ id: string; eventId: string }>();
  const t = useTranslations();
  const eventsHref = `/dashboard/cards/${id}/events`;

  return (
    <AccountGate
      title={t("shell.event")}
      breadcrumb={[
        { label: t("shell.cards"), href: "/dashboard" },
        { label: t("events.title"), href: eventsHref },
        { label: t("shell.event") },
      ]}
      back={{ href: eventsHref, label: t("events.title") }}
    >
      <CardScope cardId={id}>
        {(card) => (
          <EventScope card={card} eventId={eventId}>
            {(event) => <EventEditor cardId={card.id} card={card} event={event} />}
          </EventScope>
        )}
      </CardScope>
    </AccountGate>
  );
}
