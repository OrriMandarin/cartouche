"use client";

import type { components } from "@cartouche/api-client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { CardStatusBadge } from "@/components/cards/CardStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardDisplayName } from "@/lib/cards/display-name";
import type { CardView } from "@/lib/cards/types";
import { STATUS_VARIANT } from "./UserModerationTable";

type AdminUser = components["schemas"]["AdminUserView"];

/**
 * spec: ADM-006, ADM-013, ADM-016. An account's profile and all its cards, whatever their state, each one opening
 * read-only.
 */
export function UserCards({ user, cards }: { user: AdminUser; cards: CardView[] }) {
  const t = useTranslations("support");

  return (
    <div className="space-y-6">
      <dl
        className="bg-app-surface border-app-border rounded-app-lg shadow-app-sm grid items-center gap-x-6 gap-y-2 border p-4 @min-[600px]:grid-cols-[auto_1fr] @min-[600px]:p-6"
        data-testid="support-user-profile"
      >
        <dt className="text-app-muted">{t("columns.name")}</dt>
        <dd data-testid="support-user-name" className="font-medium">
          {user.display_name || user.email || user.subject}
        </dd>
        <dt className="text-app-muted">{t("columns.email")}</dt>
        <dd data-testid="support-user-email">{user.email}</dd>
        <dt className="text-app-muted">{t("columns.status")}</dt>
        <dd>
          <Badge variant={STATUS_VARIANT[user.status]} data-testid="support-user-status">
            {t(`status.${user.status}`)}
          </Badge>
        </dd>
      </dl>

      <h2 className="text-xl leading-[1.3] font-[650] tracking-[-0.01em]">{t("cards.title")}</h2>
      {cards.length === 0 ? (
        <p data-testid="support-user-no-cards" className="text-app-muted rounded-app-lg border border-dashed p-4 text-sm">
          {t("cards.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {cards.map((card) => (
            <li
              key={card.id}
              data-testid={`support-card-row-${card.slug}`}
              className="bg-app-surface border-app-border rounded-app-lg shadow-app-sm flex flex-wrap items-center justify-between gap-3 border p-4"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold">{cardDisplayName(card.content) ?? t("cards.untitled")}</p>
                <p className="text-app-muted font-mono text-xs">{card.slug}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <CardStatusBadge status={card.status} slug={card.slug} />
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/support/cards/${card.id}`} data-testid={`support-card-view-${card.slug}`}>
                    {t("cards.view")}
                  </Link>
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/support/cards/${card.id}/events`} data-testid={`support-card-events-${card.slug}`}>
                    {t("events.open")}
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
