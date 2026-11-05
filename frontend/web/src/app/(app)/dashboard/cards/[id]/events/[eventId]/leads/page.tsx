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
import { countLeads } from "@/lib/events/export-count";
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
function EventLeads({ cardSlug, eventId, title }: { cardSlug: string; eventId: string; title: string }) {
  const api = useApi();
  const load = useCallback(async () => {
    const { data } = await api.GET("/api/events/{id}/leads", { params: { path: { id: eventId } } });
    if (!data) throw new Error("empty response");
    return data.leads;
  }, [api, eventId]);
  const actions = useMemo(() => ownerLeadActions(api), [api]);

  return (
    <LeadList
      load={load}
      actions={actions}
      showEvent={false}
      toolbar={(leads) =>
        leads === null ? null : (
          <div>
            <ExportDialog
              scope={{ kind: "event", id: eventId }}
              summary={{ cardSlug, eventTitle: title, counts: countLeads(leads) }}
            />
          </div>
        )
      }
    />
  );
}

/** spec: EDI-020, LEA-021. The contacts of one event of one card of the signed-in user. */
export default function EventLeadsPage() {
  const { id, eventId } = useParams<{ id: string; eventId: string }>();
  const t = useTranslations();
  const eventsHref = `/dashboard/cards/${id}/events`;

  return (
    <AccountGate
      title={t("leads.title")}
      breadcrumb={[
        { label: t("shell.cards"), href: "/dashboard" },
        { label: t("events.title"), href: eventsHref },
        { label: t("leads.title") },
      ]}
      back={{ href: eventsHref, label: t("events.title") }}
    >
      <CardScope cardId={id}>
        {(card) => (
          <EventScope card={card} eventId={eventId}>
            {(event) => (
              <section className="space-y-6">
                <LeadsHeader cardId={card.id} title={event.title} />
                <EventLeads cardSlug={card.slug} eventId={event.id} title={event.title} />
              </section>
            )}
          </EventScope>
        )}
      </CardScope>
    </AccountGate>
  );
}
