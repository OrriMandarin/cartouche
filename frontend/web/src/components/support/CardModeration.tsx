"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api";
import type { CardView } from "@/lib/cards/types";

/**
 * spec: ADM-009, ADM-010. Blocks an abusive card, or lifts the block the support put on it. The owner's own
 * switch is not touched. The button stays disabled from the click until `onChanged` (the reload) settles.
 */
export function CardModeration({ card, onChanged }: { card: CardView; onChanged: () => Promise<void> }) {
  const t = useTranslations("support.cards");
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const blocked = card.status === "disabled_by_support";

  async function run() {
    setBusy(true);
    setError(null);
    const params = { params: { path: { id: card.id } } };
    try {
      await (blocked
        ? api.POST("/api/admin/cards/{id}/support-enable", params)
        : api.POST("/api/admin/cards/{id}/support-disable", params));
    } catch (e) {
      setError(e);
      setBusy(false);
      return;
    }
    try {
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        variant={blocked ? "default" : "destructive"}
        disabled={busy}
        data-testid={blocked ? "support-card-enable" : "support-card-disable"}
        onClick={() => void run()}
      >
        {blocked ? t("enable") : t("disable")}
      </Button>
      {error !== null ? <ErrorNotice error={error} /> : null}
    </div>
  );
}
