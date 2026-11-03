"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { eventErrorKey } from "@/lib/events/errors";
import { canEndNow } from "@/lib/events/groups";
import type { EventView } from "@/lib/events/types";

/**
 * spec: EVT-006, EVT-009, EVT-021, EVT-024. Edit, see the contacts of, end now and delete an event.
 * Every button stays disabled from the click until `onChanged` (which reloads the list) settles.
 */
export function EventActions({ event, onChanged }: { event: EventView; onChanged: () => Promise<void> }) {
  const t = useTranslations("events");
  const tAll = useTranslations();
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [deleting, setDeleting] = useState(false);
  const params = { params: { path: { id: event.id } } };
  const base = `/dashboard/cards/${event.card_id}/events/${event.id}`;
  const knownError = eventErrorKey(error);

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
          <Link href={base} data-testid={`event-edit-${event.id}`}>
            {t("actions.edit")}
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={`${base}/leads`} data-testid={`event-contacts-${event.id}`}>
            {t("actions.leads")}
          </Link>
        </Button>
        {canEndNow(event) ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            data-testid={`event-end-now-${event.id}`}
            onClick={() => void run(() => api.POST("/api/events/{id}/end", params))}
          >
            {t("actions.endNow")}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          data-testid={`event-delete-${event.id}`}
          onClick={() => setDeleting(true)}
        >
          {t("actions.delete")}
        </Button>
      </div>
      {knownError !== null ? (
        <Alert variant="destructive" data-testid="event-action-error">
          <AlertDescription>{tAll(knownError)}</AlertDescription>
        </Alert>
      ) : error !== null ? (
        <ErrorNotice error={error} />
      ) : null}

      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent closeLabel={t("close")}>
          <DialogHeader>
            <DialogTitle>{t("delete.title")}</DialogTitle>
            <DialogDescription>{t("delete.description", { title: event.title, count: event.lead_count })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" data-testid="event-delete-cancel" onClick={() => setDeleting(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              data-testid="event-delete-confirm"
              disabled={busy}
              onClick={() => {
                setDeleting(false);
                void run(() => api.DELETE("/api/events/{id}", params));
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
