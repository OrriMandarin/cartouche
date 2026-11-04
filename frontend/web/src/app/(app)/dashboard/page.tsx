"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountGate, useMe } from "@/components/account/AccountGate";
import { CardList, CardListEmpty, CardListSkeleton } from "@/components/cards/CardList";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api";
import { countActive } from "@/lib/cards/status";
import type { CardView } from "@/lib/cards/types";

function DashboardContent() {
  const t = useTranslations("dashboard");
  const tCards = useTranslations("cards");
  const me = useMe();
  const api = useApi();
  const [cards, setCards] = useState<CardView[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const latestRequest = useRef(0);

  // Resolves once the list is reloaded (never rejects), so the actions can wait for it.
  const reload = useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const { data } = await api.GET("/api/cards");
      if (!data) throw new Error("empty response");
      if (request !== latestRequest.current) return; // a newer reload superseded this one
      setCards(data.cards);
      setError(null);
    } catch (e) {
      if (request === latestRequest.current) setError(e);
    }
  }, [api]);

  useEffect(() => {
    void (async () => {
      await reload();
    })();
  }, [reload]);


  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="@max-[847px]:sr-only text-[28px] leading-[1.2] font-bold tracking-[-0.02em]">{t("title")}</h1>
          {cards !== null && cards.length > 0 ? (
            <p data-testid="dashboard-summary" className="text-app-muted">
              {t("summary", { total: cards.length, active: countActive(cards) })}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {me.is_admin ? (
            <Button asChild variant="secondary">
              <Link href="/support" data-testid="nav-support">
                {t("support")}
              </Link>
            </Button>
          ) : null}
          {cards !== null && cards.length > 0 ? (
            <Button asChild className="@max-[847px]:hidden">
              <Link href="/dashboard/cards/new" data-testid="new-card">
                <Plus aria-hidden="true" />
                {tCards("create")}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      {error !== null ? <ErrorNotice error={error} /> : null}
      {cards === null ? (
        error === null ? <CardListSkeleton /> : null
      ) : cards.length === 0 ? (
        <CardListEmpty />
      ) : (
        <CardList cards={cards} onChanged={reload} />
      )}
    </section>
  );
}

export default function DashboardPage() {
  const t = useTranslations("shell");
  const tCards = useTranslations("cards");
  return (
    <AccountGate
      title={t("cards")}
      action={
        <Link
          href="/dashboard/cards/new"
          aria-label={tCards("create")}
          data-testid="new-card-bar"
          className="rounded-app grid size-11 flex-none place-items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-primary"
        >
          <Plus aria-hidden="true" className="size-5" />
        </Link>
      }
    >
      <DashboardContent />
    </AccountGate>
  );
}
