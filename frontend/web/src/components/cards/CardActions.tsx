"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApi } from "@/lib/api";
import { cardDisplayName } from "@/lib/cards/display-name";
import { useSlugAvailability } from "@/lib/cards/slug-availability";
import { useSlugSuggestion } from "@/lib/cards/slug-suggestion";
import { canDuplicate, canToggle } from "@/lib/cards/status";
import type { CardView } from "@/lib/cards/types";
import { SlugField } from "./SlugField";

function DuplicateForm({
  card,
  disabled,
  onConfirm,
  onCancel,
}: {
  card: CardView;
  disabled: boolean;
  onConfirm: (slug: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("cards");
  const suggestion = useSlugSuggestion(card.content.first_name ?? "", card.content.last_name ?? "");
  const [typed, setTyped] = useState<string | null>(null);
  const slug = typed ?? suggestion ?? "";
  const { status } = useSlugAvailability(slug);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (status === "free") onConfirm(slug.trim());
      }}
    >
      <SlugField value={slug} onChange={setTyped} status={status} />
      <DialogFooter>
        <Button type="button" variant="outline" data-testid="card-duplicate-cancel" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" data-testid="card-duplicate-confirm" disabled={disabled || status !== "free"}>
          {t("duplicate.confirm")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * spec: LNK-005, LNK-011, EDI-002, EDI-014. Edit, disable or enable, duplicate and delete a card.
 * Every button stays disabled from the click until `onChanged` (which reloads the list) settles.
 */
export function CardActions({ card, onChanged }: { card: CardView; onChanged: () => Promise<void> }) {
  const t = useTranslations("cards");
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [duplicating, setDuplicating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const params = { params: { path: { id: card.id } } };

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
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
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href={`/dashboard/cards/${card.id}`} data-testid={`card-edit-${card.slug}`}>
            {t("actions.edit")}
          </Link>
        </Button>
        {canToggle(card.status) ? (
          card.status === "active" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              data-testid={`card-disable-${card.slug}`}
              onClick={() => void run(() => api.POST("/api/cards/{id}/disable", params))}
            >
              {t("actions.disable")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              data-testid={`card-enable-${card.slug}`}
              onClick={() => void run(() => api.POST("/api/cards/{id}/enable", params))}
            >
              {t("actions.enable")}
            </Button>
          )
        ) : (
          <span data-testid={`card-blocked-${card.slug}`} className="text-destructive text-sm font-medium">
            {t("status.disabledBySupport")}
          </span>
        )}
        {canDuplicate(card.status) ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            data-testid={`card-duplicate-${card.slug}`}
            onClick={() => setDuplicating(true)}
          >
            {t("actions.duplicate")}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          data-testid={`card-delete-${card.slug}`}
          onClick={() => setDeleting(true)}
        >
          {t("actions.delete")}
        </Button>
      </div>
      {error !== null ? <ErrorNotice error={error} /> : null}

      <Dialog open={duplicating} onOpenChange={setDuplicating}>
        <DialogContent closeLabel={t("close")}>
          <DialogHeader>
            <DialogTitle>{t("duplicate.title")}</DialogTitle>
            <DialogDescription>{t("duplicate.description")}</DialogDescription>
          </DialogHeader>
          <DuplicateForm
            card={card}
            disabled={busy}
            onCancel={() => setDuplicating(false)}
            onConfirm={(slug) => {
              setDuplicating(false);
              void run(() => api.POST("/api/cards/{id}/duplicate", { ...params, body: { slug } }));
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent closeLabel={t("close")}>
          <DialogHeader>
            <DialogTitle>{t("delete.title")}</DialogTitle>
            <DialogDescription>
              {t("delete.description", { name: cardDisplayName(card.content) ?? card.slug })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" data-testid="card-delete-cancel" onClick={() => setDeleting(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              data-testid="card-delete-confirm"
              disabled={busy}
              onClick={() => {
                setDeleting(false);
                void run(() => api.DELETE("/api/cards/{id}", params));
              }}
            >
              {t("delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
