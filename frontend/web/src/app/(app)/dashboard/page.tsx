"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountGate, useMe } from "@/components/account/AccountGate";
import { CardList } from "@/components/cards/CardList";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api";
import type { CardView } from "@/lib/cards/types";

function DashboardContent() {
  const t = useTranslations("dashboard");
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <div className="flex items-center gap-2">
          {me.is_admin ? (
            <Button asChild variant="outline">
              <Link href="/support" data-testid="nav-support">
                {t("support")}
              </Link>
            </Button>
          ) : null}
          <Button asChild>
            <Link href="/dashboard/cards/new" data-testid="new-card">
              {t("newCard")}
            </Link>
          </Button>
        </div>
      </div>
      {error !== null ? <ErrorNotice error={error} /> : null}
      {cards === null ? (
        error === null ? (
          <p data-testid="dashboard-loading" className="text-muted-foreground py-6 text-center">
            {t("loading")}
          </p>
        ) : null
      ) : cards.length === 0 ? (
        <p data-testid="dashboard-empty" className="text-muted-foreground rounded-lg border border-dashed p-10 text-center">
          {t("empty")}
        </p>
      ) : (
        <CardList cards={cards} onChanged={reload} />
      )}
    </section>
  );
}

export default function DashboardPage() {
  return (
    <AccountGate>
      <DashboardContent />
    </AccountGate>
  );
}
