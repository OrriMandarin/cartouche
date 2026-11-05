"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AccountGate } from "@/components/account/AccountGate";
import { CardScope } from "@/components/events/CardScope";
import { EventEditor } from "@/components/events/EventEditor";

/** spec: EDI-019, EVT-001. Creation of an event of one card of the signed-in user. */
export default function NewEventPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations();
  const eventsHref = `/dashboard/cards/${id}/events`;

  return (
    <AccountGate
      title={t("shell.newEvent")}
      breadcrumb={[
        { label: t("shell.cards"), href: "/dashboard" },
        { label: t("events.title"), href: eventsHref },
        { label: t("shell.newEvent") },
      ]}
      back={{ href: eventsHref, label: t("events.title") }}
    >
      <CardScope cardId={id}>{(card) => <EventEditor cardId={card.id} card={card} />}</CardScope>
    </AccountGate>
  );
}
