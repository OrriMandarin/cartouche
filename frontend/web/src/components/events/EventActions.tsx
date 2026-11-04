"use client";

import { Pencil, Square, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api";
import { eventErrorKey } from "@/lib/events/errors";
import { canEndNow } from "@/lib/events/groups";
import type { EventView } from "@/lib/events/types";
import { DeleteEventDialog } from "./DeleteEventDialog";

/**
 * spec: EVT-006, EVT-009, EVT-021, EVT-024, EDI-033. Edit, end now and delete an event (the contacts are one link away).
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
      <div className="flex items-center gap-1.5 @max-[847px]:[&>[data-slot=button]:not(:last-child)]:flex-1 @min-[848px]:justify-end">
        <Button asChild variant="secondary" className="px-3">
          <Link href={base} data-testid={`event-edit-${event.id}`}>
            <Pencil aria-hidden="true" />
            {t("actions.edit")}
          </Link>
        </Button>
        {canEndNow(event) ? (
          <Button
            variant="secondary"
            className="px-3"
            disabled={busy}
            data-testid={`event-end-now-${event.id}`}
            onClick={() => void run(() => api.POST("/api/events/{id}/end", params))}
          >
            <Square aria-hidden="true" />
            {t("actions.endNow")}
          </Button>
        ) : null}
        <Button
          variant="dangerGhost"
          size="icon"
          disabled={busy}
          aria-label={t("actions.delete", { title: event.title })}
          data-testid={`event-delete-${event.id}`}
          onClick={() => setDeleting(true)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
      {knownError !== null ? (
        <Alert variant="destructive" data-testid="event-action-error">
          <AlertDescription>{tAll(knownError)}</AlertDescription>
        </Alert>
      ) : error !== null ? (
        <ErrorNotice error={error} />
      ) : null}

      <DeleteEventDialog
        event={event}
        open={deleting}
        onOpenChange={setDeleting}
        onConfirm={() => {
          setDeleting(false);
          void run(() => api.DELETE("/api/events/{id}", params));
        }}
      />
    </div>
  );
}
