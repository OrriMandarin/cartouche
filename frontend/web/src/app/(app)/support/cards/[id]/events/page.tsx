"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useCallback } from "react";
import { AccountGate } from "@/components/account/AccountGate";
import { SupportEventList } from "@/components/support/SupportEventList";
import { SupportGuard } from "@/components/support/SupportGuard";
import { SupportBackLink } from "@/components/support/SupportBackLink";
import { SupportLoader } from "@/components/support/SupportLoader";
import { SupportTitle } from "@/components/support/SupportTitle";
import { useSupportSlots } from "@/components/support/useSupportSlots";
import { useApi } from "@/lib/api";

function EventsContent({ cardId }: { cardId: string }) {
  const t = useTranslations("support");
  const api = useApi();
  const load = useCallback(async () => {
    const { data } = await api.GET("/api/admin/cards/{id}/events", { params: { path: { id: cardId } } });
    if (!data) throw new Error("empty response");
    return data.events;
  }, [api, cardId]);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-1">
        <SupportBackLink href={`/support/cards/${cardId}`}>{t("events.backToCard")}</SupportBackLink>
        <SupportTitle>{t("events.title")}</SupportTitle>
      </div>
      <SupportLoader load={load} notFound={t("cards.cardNotFound")}>
        {(events) => <SupportEventList cardId={cardId} events={events} />}
      </SupportLoader>
    </section>
  );
}

/** spec: ADM-016, ADM-001. Admin-only: the events of a user's card, read-only. */
export default function SupportCardEventsPage() {
  const { id } = useParams<{ id: string }>();
  const slots = useSupportSlots({ kind: "events", cardId: id });
  return (
    <AccountGate {...slots}>
      <SupportGuard>
        <EventsContent cardId={id} />
      </SupportGuard>
    </AccountGate>
  );
}
