"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { qrFileName, qrPng, qrSvg, saveBlob } from "@/lib/cards/qr";
import type { CardView } from "@/lib/cards/types";

type Feedback = "copied" | "copyFailed" | "qrFailed" | null;

/** spec: LNK-017, LNK-029. Copies the card's public link and downloads its QR code as SVG or PNG. */
export function ShareCard({ card }: { card: Pick<CardView, "slug" | "public_url"> }) {
  const t = useTranslations("cards.share");
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(card.public_url);
      setFeedback("copied");
    } catch {
      setFeedback("copyFailed");
    }
  }

  async function download(format: "svg" | "png") {
    try {
      const blob =
        format === "svg"
          ? new Blob([await qrSvg(card.public_url)], { type: "image/svg+xml" })
          : await qrPng(card.public_url);
      saveBlob(blob, qrFileName(card.slug, format));
      setFeedback(null);
    } catch {
      setFeedback("qrFailed");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" data-testid={`card-copy-${card.slug}`} onClick={() => void copy()}>
        {t("copy")}
      </Button>
      <Button size="sm" variant="outline" data-testid={`card-qr-svg-${card.slug}`} onClick={() => void download("svg")}>
        {t("qrSvg")}
      </Button>
      <Button size="sm" variant="outline" data-testid={`card-qr-png-${card.slug}`} onClick={() => void download("png")}>
        {t("qrPng")}
      </Button>
      <span role="status" data-testid={`card-share-feedback-${card.slug}`} className="text-muted-foreground text-sm">
        {feedback === null ? null : t(feedback)}
      </span>
    </div>
  );
}
