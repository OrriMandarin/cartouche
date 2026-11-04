"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { Pencil } from "lucide-react";
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
import { useSlugAvailability } from "@/lib/cards/slug-availability";
import { useSlugSuggestion } from "@/lib/cards/slug-suggestion";
import { canEdit } from "@/lib/cards/status";
import type { CardView } from "@/lib/cards/types";
import { CardMenu } from "./CardMenu";
import { DeleteCardDialog } from "./DeleteCardDialog";
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
        <Button type="button" variant="secondary" data-testid="card-duplicate-cancel" onClick={onCancel}>
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
 * spec: LNK-005, LNK-011, EDI-002, EDI-014, LNK-036. Edit a card, and through its menu disable or enable, duplicate and
 * delete it. Every menu action stays disabled from the click until `onChanged` (which reloads the list) settles.
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
    <div className="flex flex-col items-stretch gap-2 @min-[848px]:items-end">
      <div className="flex items-center justify-end gap-1.5">
        {canEdit(card.status) ? (
          <Button asChild variant="secondary" className="flex-1 @min-[848px]:flex-none">
            <Link href={`/dashboard/cards/${card.id}`} data-testid={`card-edit-${card.slug}`}>
              <Pencil aria-hidden="true" />
              {t("actions.edit")}
            </Link>
          </Button>
        ) : null}
        <CardMenu
          card={card}
          busy={busy}
          onDuplicate={() => setDuplicating(true)}
          onDelete={() => setDeleting(true)}
          onToggle={() =>
            void run(() => api.POST(card.status === "active" ? "/api/cards/{id}/disable" : "/api/cards/{id}/enable", params))
          }
        />
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

      <DeleteCardDialog
        card={card}
        open={deleting}
        onOpenChange={setDeleting}
        onConfirm={() => void run(() => api.DELETE("/api/cards/{id}", params))}
      />
    </div>
  );
}
