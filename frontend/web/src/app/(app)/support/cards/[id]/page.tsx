"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback } from "react";
import { AccountGate } from "@/components/account/AccountGate";
import { CardDetail } from "@/components/support/CardDetail";
import { SupportGuard } from "@/components/support/SupportGuard";
import { SupportLoader } from "@/components/support/SupportLoader";
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
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <Link href="/support" className="text-sm underline" data-testid="nav-support">
          {t("cards.backToSupport")}
        </Link>
      </div>
      <SupportLoader load={load} notFound={t("cards.cardNotFound")}>
        {({ card, owner }, reload) => <CardDetail card={card} owner={owner} onChanged={reload} />}
      </SupportLoader>
    </section>
  );
}

/** spec: ADM-012, ADM-013. Admin-only: a card in read-only preview, with the moderation action. */
export default function SupportCardPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <AccountGate>
      <SupportGuard>
        <CardContent id={id} />
      </SupportGuard>
    </AccountGate>
  );
}
