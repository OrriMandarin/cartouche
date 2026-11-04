"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { CardView } from "@/lib/cards/types";

/**
 * spec: EDI-002, EDI-024. Confirms the deletion of a card and announces what goes with it: its events, its
 * contacts, and the unavailable page that its NFC tags and QR codes will show.
 */
export function DeleteCardDialog({
  card,
  open,
  onOpenChange,
  onConfirm,
}: {
  card: CardView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("cards.delete");
  const { running, upcoming, past } = card.event_counts;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <span className="bg-app-danger-soft text-app-danger grid size-11 place-items-center rounded-full">
            <Trash2 aria-hidden="true" className="size-5" />
          </span>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t.rich("description", {
              slug: card.slug,
              events: running + upcoming + past,
              leads: card.lead_count,
              total: running + upcoming + past + card.lead_count,
              b: (chunks) => <b className="text-app-text">{chunks}</b>,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="card-delete-cancel">{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" data-testid="card-delete-confirm" onClick={onConfirm}>
            <Trash2 aria-hidden="true" className="size-5" />
            {t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
