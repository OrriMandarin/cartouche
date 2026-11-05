"use client";

import { ApiError } from "@cartouche/api-client";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useCallback } from "react";
import { AccountGate } from "@/components/account/AccountGate";
import { SupportGuard } from "@/components/support/SupportGuard";
import { SupportLeads } from "@/components/support/SupportLeads";
import { SupportLoader } from "@/components/support/SupportLoader";
import { useSupportSlots } from "@/components/support/useSupportSlots";
import { useApi } from "@/lib/api";

function EventLeadsContent({ cardId, eventId }: { cardId: string; eventId: string }) {
  const t = useTranslations("support.leads");
  const api = useApi();
  // The event is found among the card's events, which is not audited: the leads are requested only once it exists.
  const loadEvent = useCallback(async () => {
    const { data } = await api.GET("/api/admin/cards/{id}/events", { params: { path: { id: cardId } } });
    const event = data?.events.find((candidate) => candidate.id === eventId);
    if (!event) throw new ApiError({ status: 404, code: "not_found", message: "No such event.", requestId: null });
    return event;
  }, [api, cardId, eventId]);
  const loadLeads = useCallback(async () => {
    const { data } = await api.GET("/api/admin/events/{id}/leads", { params: { path: { id: eventId } } });
    if (!data) throw new Error("empty response");
    return data.leads;
  }, [api, eventId]);

  return (
    <SupportLoader load={loadEvent} notFound={t("eventNotFound")}>
      {(event) => (
        <SupportLeads
          backHref={`/support/cards/${cardId}/events`}
          title={t("title")}
          subtitle={event.title}
          load={loadLeads}
          showEvent={false}
        />
      )}
    </SupportLoader>
  );
}

/** spec: ADM-017, ADM-018, ADM-001. Admin-only: the leads of one event, read-only and audited. */
export default function SupportEventLeadsPage() {
  const { id, eventId } = useParams<{ id: string; eventId: string }>();
  const slots = useSupportSlots({ kind: "eventLeads", cardId: id });
  return (
    <AccountGate {...slots}>
      <SupportGuard>
        <EventLeadsContent cardId={id} eventId={eventId} />
      </SupportGuard>
    </AccountGate>
  );
}
