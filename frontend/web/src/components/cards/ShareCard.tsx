"use client";

import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { qrFileName, qrPng, qrSvg, saveBlob } from "@/lib/cards/qr";
import type { CardView } from "@/lib/cards/types";
import { showToast } from "@/lib/toast";

type Shared = Pick<CardView, "slug" | "public_url">;

/** The browser clipboard, behind a function so tests can replace it. */
export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

/** spec: LNK-017, LNK-029, EDI-023. The icon button that copies a card's public link and confirms with a toast. */
export function CopyLinkButton({ card, copy = copyToClipboard }: { card: Shared; copy?: (text: string) => Promise<void> }) {
  const t = useTranslations("cards.share");

  async function onClick() {
    try {
      await copy(card.public_url);
      showToast(t("copied", { link: card.public_url }));
    } catch {
      showToast(t("copyFailed"));
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t("copyLabel", { slug: card.slug })}
      data-testid={`card-copy-${card.slug}`}
      onClick={() => void onClick()}
    >
      <Copy aria-hidden="true" />
    </Button>
  );
}

/** spec: LNK-017, LNK-029. Downloads a card's QR code as `<slug>.svg` or `<slug>.png`, and says so when it fails. */
export async function downloadQr(card: Shared, format: "svg" | "png", failedMessage: string): Promise<void> {
  try {
    const blob =
      format === "svg"
        ? new Blob([await qrSvg(card.public_url)], { type: "image/svg+xml" })
        : await qrPng(card.public_url);
    saveBlob(blob, qrFileName(card.slug, format));
  } catch {
    showToast(failedMessage);
  }
}
