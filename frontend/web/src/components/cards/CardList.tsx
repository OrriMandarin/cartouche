"use client";

import { useTranslations } from "next-intl";
import { cardDisplayName } from "@/lib/cards/display-name";
import type { CardView } from "@/lib/cards/types";
import { CardActions } from "./CardActions";
import { CardStatusBadge } from "./CardStatusBadge";
import { ShareCard } from "./ShareCard";

/** spec: EDI-012. One row per card: name, public link, status and the card's actions. */
export function CardList({ cards, onChanged }: { cards: CardView[]; onChanged: () => Promise<void> }) {
  const t = useTranslations("cards");

  return (
    <ul className="space-y-4">
      {cards.map((card) => (
        <li
          key={card.id}
          data-testid={`card-row-${card.slug}`}
          className="bg-card space-y-3 rounded-lg border p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p data-testid={`card-name-${card.slug}`} className="truncate text-lg font-semibold">
                {cardDisplayName(card.content) ?? t("untitled")}
              </p>
              <a
                href={card.public_url}
                data-testid={`card-url-${card.slug}`}
                className="text-muted-foreground text-sm break-all underline"
              >
                {card.public_url}
              </a>
            </div>
            <CardStatusBadge status={card.status} slug={card.slug} />
          </div>
          <CardActions card={card} onChanged={onChanged} />
          <ShareCard card={card} />
        </li>
      ))}
    </ul>
  );
}
