"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountGate } from "@/components/account/AccountGate";
import { ErrorNotice } from "@/components/ErrorNotice";
import { useApi } from "@/lib/api";
import { cardDisplayName } from "@/lib/cards/display-name";
import type { CardView } from "@/lib/cards/types";

function ContactsContent() {
  const t = useTranslations("contactsPage");
  const api = useApi();
  const [cards, setCards] = useState<CardView[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await api.GET("/api/cards");
        if (!data) throw new Error("empty response");
        setCards(data.cards);
      } catch (e) {
        setError(e);
      }
    })();
  }, [api]);

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-app-muted">{t("description")}</p>
      </div>
      {error !== null ? <ErrorNotice error={error} /> : null}
      {cards === null ? (
        error === null ? <p data-testid="contacts-loading">{t("loading")}</p> : null
      ) : cards.length === 0 ? (
        <p data-testid="contacts-empty">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {cards.map((card) => (
            <li key={card.id}>
              <Link
                href={`/dashboard/cards/${card.id}/leads`}
                data-testid={`contacts-card-${card.id}`}
                className="bg-app-surface border-app-border rounded-app-lg flex min-h-11 items-center border px-4 py-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-primary"
              >
                {cardDisplayName(card.content) ?? card.slug}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Placeholder of the contacts entry of the navigation: one link per card to its contacts. Replaced by the contacts page. */
export default function ContactsPage() {
  const t = useTranslations("shell");
  return (
    <AccountGate title={t("contacts")}>
      <ContactsContent />
    </AccountGate>
  );
}
