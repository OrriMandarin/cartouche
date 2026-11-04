"use client";

import { Calendar, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cardDisplayName } from "@/lib/cards/display-name";
import { eventSummary } from "@/lib/cards/summary";
import type { CardView } from "@/lib/cards/types";
import { supportMailto } from "@/lib/instance-links";
import { CardActions } from "./CardActions";
import { CardStatusBadge } from "./CardStatusBadge";
import { CardThumbnail } from "./CardThumbnail";
import { CopyLinkButton } from "./ShareCard";

const GRID =
  "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 @min-[848px]:grid-cols-[56px_minmax(0,1.2fr)_minmax(0,1.4fr)_128px_180px_140px] @min-[848px]:gap-x-4 @min-[848px]:px-5";

function EventsSummary({ card }: { card: CardView }) {
  const t = useTranslations("cards.events");
  const parts = eventSummary(card.event_counts);
  return (
    <Link
      href={`/dashboard/cards/${card.id}/events`}
      data-testid={`card-events-${card.slug}`}
      className="text-app-text focus-visible:outline-app-ring inline-flex min-h-11 items-center gap-2 whitespace-nowrap justify-self-end text-[13px] font-semibold underline underline-offset-3 focus-visible:outline-2 focus-visible:outline-offset-2 @min-[848px]:justify-self-start @min-[848px]:text-sm"
    >
      <Calendar aria-hidden="true" className="size-[18px]" />
      {parts.length === 0 ? t("none") : parts.map((part) => t(part.key, { count: part.count })).join(" · ")}
    </Link>
  );
}

/**
 * spec: EDI-012, EDI-023. The owner's cards. On a computer a table, on a phone one card each: thumbnail in the
 * card's colors, name, copiable public link, state, events summary and actions.
 */
export function CardList({ cards, onChanged }: { cards: CardView[]; onChanged: () => Promise<void> }) {
  const t = useTranslations("cards");

  return (
    <div className="space-y-4">
      <div className="@min-[848px]:bg-app-surface @min-[848px]:border-app-border @min-[848px]:rounded-app-lg @min-[848px]:shadow-app-sm @min-[848px]:border">
        <div
          aria-hidden="true"
          className={`${GRID} text-app-muted border-app-border hidden min-h-11 border-b text-xs font-bold tracking-[.06em] uppercase @min-[848px]:grid`}
        >
          <span />
          <span>{t("columns.card")}</span>
          <span>{t("columns.link")}</span>
          <span>{t("columns.status")}</span>
          <span>{t("columns.events")}</span>
          <span />
        </div>
        <ul className="flex flex-col gap-3 @min-[848px]:gap-0">
          {cards.map((card) => (
            <li
              key={card.id}
              data-testid={`card-row-${card.slug}`}
              className={`${GRID} bg-app-surface border-app-border rounded-app-lg shadow-app-sm border p-4 @min-[848px]:min-h-[104px] @min-[848px]:rounded-none @min-[848px]:border-0 @min-[848px]:border-b @min-[848px]:py-0 @min-[848px]:shadow-none @min-[848px]:last:border-b-0`}
            >
              <CardThumbnail theme={card.theme} firstName={card.content.first_name} lastName={card.content.last_name} />
              <div className="min-w-0 @max-[847px]:col-span-2">
                <p data-testid={`card-name-${card.slug}`} className="truncate text-base font-[650]">
                  {cardDisplayName(card.content) ?? t("untitled")}
                </p>
                {card.content.job_title ? (
                  <p className="text-app-muted truncate text-sm">{card.content.job_title}</p>
                ) : null}
              </div>
              <div className="bg-app-surface-2 flex min-w-0 items-center gap-0.5 rounded-[10px] pl-3 @max-[847px]:order-1 @max-[847px]:col-span-3 @min-[848px]:bg-transparent @min-[848px]:pl-0">
                <a
                  href={card.public_url}
                  data-testid={`card-url-${card.slug}`}
                  className="font-app-mono min-w-0 flex-1 truncate text-[13px] hover:underline"
                >
                  {card.public_url}
                </a>
                <CopyLinkButton card={card} />
              </div>
              <div className="flex flex-col items-start gap-1 @max-[847px]:col-span-2">
                <CardStatusBadge status={card.status} slug={card.slug} />
                {card.status === "disabled_by_support" ? (
                  <a
                    href={supportMailto()}
                    data-testid={`card-support-${card.slug}`}
                    className="text-app-muted text-[13px] underline"
                  >
                    {t("contactSupport")}
                  </a>
                ) : null}
              </div>
              <EventsSummary card={card} />
              <div className="@max-[847px]:order-2 @max-[847px]:col-span-3">
                <CardActions card={card} onChanged={onChanged} />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-app-muted text-[13px]">{t("hint")}</p>
    </div>
  );
}

/** spec: EDI-025. No card yet: the promise of what a card is, and one button to create the first. */
export function CardListEmpty() {
  const t = useTranslations("cards.empty");
  return (
    <div
      data-testid="dashboard-empty"
      className="bg-app-surface border-app-border rounded-app-lg shadow-app-sm flex flex-col items-center gap-4 border px-6 py-16 text-center @min-[848px]:px-10 @min-[848px]:py-[72px]"
    >
      <div className="border-app-border-strong text-app-muted grid h-24 w-[72px] place-items-center rounded-xl border-2 border-dashed">
        <Plus aria-hidden="true" className="size-6" />
      </div>
      <h2 className="font-app-display text-[26px] leading-[1.15] font-semibold @min-[848px]:text-3xl">{t("title")}</h2>
      <p className="text-app-muted max-w-[52ch] text-base">{t("text")}</p>
      <Button asChild className="mt-2">
        <Link href="/dashboard/cards/new" data-testid="new-card">
          <Plus aria-hidden="true" />
          {t("create")}
        </Link>
      </Button>
    </div>
  );
}

/** Placeholder rows while the list loads. */
export function CardListSkeleton() {
  const t = useTranslations("cards");
  return (
    <div aria-busy="true" aria-label={t("loading")} data-testid="dashboard-loading" className="flex flex-col gap-3">
      {[1, 2, 3].map((key) => (
        <div key={key} className="bg-app-surface border-app-border rounded-app-lg flex items-center gap-3 border p-4">
          <div className="bg-app-surface-2 h-[60px] w-11 animate-pulse rounded-lg motion-reduce:animate-none" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="bg-app-surface-2 h-3.5 w-1/2 animate-pulse rounded motion-reduce:animate-none" />
            <div className="bg-app-surface-2 h-3 w-4/5 animate-pulse rounded motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  );
}
