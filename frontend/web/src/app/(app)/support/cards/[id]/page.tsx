"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useCallback } from "react";
import { AccountGate } from "@/components/account/AccountGate";
import { CardDetail } from "@/components/support/CardDetail";
import { SupportGuard } from "@/components/support/SupportGuard";
import { SupportLoader } from "@/components/support/SupportLoader";
import { SupportTitle } from "@/components/support/SupportTitle";
import { useSupportSlots } from "@/components/support/useSupportSlots";
import { useApi } from "@/lib/api";

function CardContent({ id }: { id: string }) {
  const t = useTranslations("support");
  const api = useApi();
  const load = useCallback(async () => {
    const { data } = await api.GET("/api/admin/cards/{id}", { params: { path: { id } } });
    if (!data) throw new Error("empty response");
    return data;
  }, [api, id]);

  return (
    <section className="space-y-6">
      <SupportTitle>{t("title")}</SupportTitle>
      <SupportLoader load={load} notFound={t("cards.cardNotFound")}>
        {({ card, owner }, reload) => <CardDetail card={card} owner={owner} onChanged={reload} />}
      </SupportLoader>
    </section>
  );
}

/** spec: ADM-012, ADM-013. Admin-only: a card in read-only preview, with the moderation action. */
export default function SupportCardPage() {
  const { id } = useParams<{ id: string }>();
  const slots = useSupportSlots({ kind: "card" });
  return (
    <AccountGate {...slots}>
      <SupportGuard>
        <CardContent id={id} />
      </SupportGuard>
    </AccountGate>
  );
}
