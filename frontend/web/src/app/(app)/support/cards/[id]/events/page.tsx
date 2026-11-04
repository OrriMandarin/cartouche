"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback } from "react";
import { AccountGate } from "@/components/account/AccountGate";
import { SupportEventList } from "@/components/support/SupportEventList";
import { SupportGuard } from "@/components/support/SupportGuard";
import { SupportLoader } from "@/components/support/SupportLoader";
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
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">{t("events.title")}</h1>
        <Link href={`/support/cards/${cardId}`} className="text-sm underline" data-testid="support-back">
          {t("events.backToCard")}
        </Link>
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
  return (
    <AccountGate>
      <SupportGuard>
        <EventsContent cardId={id} />
      </SupportGuard>
    </AccountGate>
  );
}
