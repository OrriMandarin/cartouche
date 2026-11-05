"use client";

import { Copy, Download, ExternalLink, MoreHorizontal, Power, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { canDuplicate, canToggle } from "@/lib/cards/status";
import type { CardView } from "@/lib/cards/types";
import { downloadQr } from "./ShareCard";

/**
 * spec: EDI-023, LNK-011, LNK-017. The « Plus d’actions » menu of a card. A card disabled by the support only
 * offers the actions that do not write: open its page, download its QR codes, delete it.
 */
export function CardMenu({
  card,
  busy,
  onDuplicate,
  onToggle,
  onDelete,
}: {
  card: CardView;
  busy: boolean;
  onDuplicate: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("cards");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("actions.more", { slug: card.slug })}
          data-testid={`card-menu-${card.slug}`}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label={t("actions.menuLabel")}>
        <DropdownMenuItem asChild>
          <a href={card.public_url} target="_blank" rel="noreferrer" data-testid={`card-open-${card.slug}`}>
            <ExternalLink aria-hidden="true" />
            {t("actions.open")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid={`card-qr-svg-${card.slug}`}
          onSelect={() => void downloadQr(card, "svg", t("share.qrFailed"))}
        >
          <Download aria-hidden="true" />
          {t("share.qrSvg")}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid={`card-qr-png-${card.slug}`}
          onSelect={() => void downloadQr(card, "png", t("share.qrFailed"))}
        >
          <Download aria-hidden="true" />
          {t("share.qrPng")}
        </DropdownMenuItem>
        {canDuplicate(card.status) ? (
          <DropdownMenuItem disabled={busy} data-testid={`card-duplicate-${card.slug}`} onSelect={onDuplicate}>
            <Copy aria-hidden="true" />
            {t("actions.duplicate")}
          </DropdownMenuItem>
        ) : null}
        {canToggle(card.status) ? (
          <DropdownMenuItem
            disabled={busy}
            data-testid={`card-${card.status === "active" ? "disable" : "enable"}-${card.slug}`}
            onSelect={onToggle}
          >
            <Power aria-hidden="true" />
            {card.status === "active" ? t("actions.disable") : t("actions.enable")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem danger disabled={busy} data-testid={`card-delete-${card.slug}`} onSelect={onDelete}>
          <Trash2 aria-hidden="true" />
          {t("actions.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
