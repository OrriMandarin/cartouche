"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cardStatusLabelKey, type CardStatus } from "@/lib/cards/status";

const VARIANT = {
  active: "default",
  disabled: "secondary",
  disabled_by_support: "destructive",
} as const satisfies Record<CardStatus, string>;

/** spec: EDI-012. The state of a card: active, disabled or disabled by the support. */
export function CardStatusBadge({ status, slug }: { status: CardStatus; slug: string }) {
  const t = useTranslations();
  return (
    <Badge variant={VARIANT[status]} data-testid={`card-status-${slug}`}>
      {t(cardStatusLabelKey(status))}
    </Badge>
  );
}
