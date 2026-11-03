"use client";

import { useParams } from "next/navigation";
import { AccountGate } from "@/components/account/AccountGate";
import { CardScope } from "@/components/events/CardScope";
import { EventEditor } from "@/components/events/EventEditor";
import { EventScope } from "@/components/events/EventScope";

/** spec: EDI-019, EVT-009. The editor of one event of one card of the signed-in user. */
export default function EditEventPage() {
  const { id, eventId } = useParams<{ id: string; eventId: string }>();

  return (
    <AccountGate>
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
