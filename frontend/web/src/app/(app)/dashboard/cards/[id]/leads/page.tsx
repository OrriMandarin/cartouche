"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { AccountGate } from "@/components/account/AccountGate";
import { CardScope } from "@/components/events/CardScope";
import { ExportDialog } from "@/components/events/ExportDialog";
import { LeadList } from "@/components/events/LeadList";
import { useApi } from "@/lib/api";
import { cardDisplayName } from "@/lib/cards/display-name";
import type { CardView } from "@/lib/cards/types";
import { countLeads } from "@/lib/events/export-count";
import { ownerLeadActions } from "@/lib/events/lead-actions";

function CardLeads({ card }: { card: CardView }) {
  const t = useTranslations();
  const api = useApi();
  const load = useCallback(async () => {
    const { data } = await api.GET("/api/cards/{id}/leads", { params: { path: { id: card.id } } });
    if (!data) throw new Error("empty response");
    return data.leads;
  }, [api, card.id]);
  const actions = useMemo(() => ownerLeadActions(api), [api]);

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <Link href={`/dashboard/cards/${card.id}/events`} data-testid="leads-back" className="text-sm underline">
          {t("events.backToEvents")}
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">{t("leads.cardTitle")}</h1>
        <p data-testid="leads-card-name" className="text-muted-foreground">
          {cardDisplayName(card.content) ?? card.slug}
        </p>
      </header>
      <LeadList
        load={load}
        actions={actions}
        showEvent
        toolbar={(leads) =>
          leads === null ? null : (
            <div>
              <ExportDialog
                scope={{ kind: "card", id: card.id }}
                summary={{ cardSlug: card.slug, eventTitle: null, counts: countLeads(leads) }}
              />
            </div>
          )
        }
      />
    </section>
  );
}

/** spec: LEA-001, LEA-013, LEA-021. The contacts of all the events of one card of the signed-in user, with their export. */
export default function CardLeadsPage() {
  const { id } = useParams<{ id: string }>();
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
      <CardScope cardId={id}>{(card) => <CardLeads card={card} />}</CardScope>
    </AccountGate>
  );
}
