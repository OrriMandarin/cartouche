"use client";

import { useParams } from "next/navigation";
import { AccountGate } from "@/components/account/AccountGate";
import { CardScope } from "@/components/events/CardScope";
import { EventEditor } from "@/components/events/EventEditor";

/** spec: EDI-019, EVT-001. Creation of an event of one card of the signed-in user. */
export default function NewEventPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <AccountGate>
      <CardScope cardId={id}>{(card) => <EventEditor cardId={card.id} card={card} />}</CardScope>
    </AccountGate>
  );
}
