"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import type { EventView } from "@/lib/events/types";
import { ExportDialogPanel } from "./ExportDialog";

/**
 * spec: EDI-033, EVT-024, LEA-006. Confirms the deletion of an event and announces the contacts that go with it.
 * With contacts, it offers to export them first: the export replaces the confirmation while it is open, and
 * the confirmation comes back when it closes.
 */
export function DeleteEventDialog({
  event,
  open,
  onOpenChange,
  onConfirm,
}: {
  event: EventView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("events");
  const [exporting, setExporting] = useState(false);
  const count = event.lead_count;

  return (
    <>
      <AlertDialog open={open && !exporting} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <span className="bg-app-danger-soft text-app-danger grid size-11 place-items-center rounded-full">
              <Trash2 aria-hidden="true" className="size-5" />
            </span>
            <AlertDialogTitle>{t("delete.title", { title: event.title })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete.description", { count })}
              {count > 0 ? ` ${t("delete.exportHint")}` : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="event-delete-cancel">{t("cancel")}</AlertDialogCancel>
            {count > 0 ? (
              <Button variant="outline" data-testid="event-delete-export" onClick={() => setExporting(true)}>
                {t("delete.export")}
              </Button>
            ) : null}
            <AlertDialogAction variant="destructive" data-testid="event-delete-confirm" onClick={onConfirm}>
              <Trash2 aria-hidden="true" className="size-5" />
              {t("delete.confirm", { count })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ExportDialogPanel scope={{ kind: "event", id: event.id }} open={open && exporting} onOpenChange={setExporting} />
    </>
  );
}
