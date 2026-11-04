"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { AccountGate } from "@/components/account/AccountGate";
import { CardScope } from "@/components/events/CardScope";
import { EventScope } from "@/components/events/EventScope";
import { ExportDialog } from "@/components/events/ExportDialog";
import { LeadList } from "@/components/events/LeadList";
import { useApi } from "@/lib/api";
import { ownerLeadActions } from "@/lib/events/lead-actions";

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

/** The contacts of one event, loaded from the API, with the owner's actions. */
function EventLeads({ eventId }: { eventId: string }) {
  const api = useApi();
  const load = useCallback(async () => {
    const { data } = await api.GET("/api/events/{id}/leads", { params: { path: { id: eventId } } });
    if (!data) throw new Error("empty response");
    return data.leads;
  }, [api, eventId]);
  const actions = useMemo(() => ownerLeadActions(api), [api]);

  return <LeadList load={load} actions={actions} showEvent={false} toolbar={<ExportDialog scope={{ kind: "event", id: eventId }} />} />;
}

/** spec: EDI-020, LEA-021. The contacts of one event of one card of the signed-in user. */
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
                <EventLeads eventId={event.id} />
              </section>
            )}
          </EventScope>
        )}
      </CardScope>
    </AccountGate>
  );
}
