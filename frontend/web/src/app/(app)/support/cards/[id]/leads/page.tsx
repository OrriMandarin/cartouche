"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useCallback } from "react";
import { AccountGate } from "@/components/account/AccountGate";
import { SupportGuard } from "@/components/support/SupportGuard";
import { SupportLeads } from "@/components/support/SupportLeads";
import { useApi } from "@/lib/api";

function CardLeadsContent({ cardId }: { cardId: string }) {
  const t = useTranslations("support.leads");
  const api = useApi();
  const load = useCallback(async () => {
    const { data } = await api.GET("/api/admin/cards/{id}/leads", { params: { path: { id: cardId } } });
    if (!data) throw new Error("empty response");
    return data.leads;
  }, [api, cardId]);

  return <SupportLeads backHref={`/support/cards/${cardId}/events`} title={t("cardTitle")} load={load} showEvent />;
}

/** spec: ADM-017, ADM-018, LEA-013, ADM-001. Admin-only: the leads of all the events of a card, read-only and audited. */
export default function SupportCardLeadsPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <AccountGate>
      <SupportGuard>
        <CardLeadsContent cardId={id} />
      </SupportGuard>
    </AccountGate>
  );
}
