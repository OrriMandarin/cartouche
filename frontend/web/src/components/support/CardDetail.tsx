"use client";

import type { components } from "@cartouche/api-client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { CardStatusBadge } from "@/components/cards/CardStatusBadge";
import { PhonePreview } from "@/components/editor/PhonePreview";
import { cardDisplayName } from "@/lib/cards/display-name";
import { draftFromCard, publicBaseUrlOf } from "@/lib/cards/draft";
import type { CardView } from "@/lib/cards/types";
import { CardModeration } from "./CardModeration";

type AdminUser = components["schemas"]["AdminUserView"];

/**
 * spec: ADM-012, ADM-013. A card as the template shows it, read-only (no field to edit), with its owner,
 * its public address and the moderation action.
 */
export function CardDetail({
  card,
  owner,
  onChanged,
}: {
  card: CardView;
  owner: AdminUser;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("support.cards");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 data-testid="support-card-name" className="truncate text-xl font-semibold">
            {cardDisplayName(card.content) ?? t("untitled")}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t("owner")}{" "}
            <Link href={`/support/users/${owner.id}`} data-testid="support-card-owner" className="underline">
              {owner.display_name || owner.email || owner.subject}
            </Link>
          </p>
          <a
            href={card.public_url}
            data-testid="support-card-public-link"
            className="text-muted-foreground text-sm break-all underline"
          >
            {card.public_url}
          </a>
        </div>
        <CardStatusBadge status={card.status} slug={card.slug} />
      </div>
      <CardModeration card={card} onChanged={onChanged} />
      <PhonePreview draft={draftFromCard(card)} simulateEvent={false} publicBaseUrl={publicBaseUrlOf(card)} />
    </div>
  );
}
