"use client";

import { Square, Trash2, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api";
import { eventErrorKey } from "@/lib/events/errors";
import { canEndNow } from "@/lib/events/groups";
import { eventStateLine } from "@/lib/events/state";
import type { EventPhase, EventView } from "@/lib/events/types";
import { DeleteEventDialog } from "./DeleteEventDialog";

const PHASE_VARIANT = {
  running: "success",
  upcoming: "info",
  past: "neutral",
} as const satisfies Record<EventPhase, string>;

/**
 * spec: EDI-019, EVT-006, EVT-021, EDI-033, EVT-024. Where a stored event stands (phase, dates, its contacts) and
 * what can be done to it right now: end it, or delete it with its contacts. Once the event is deleted the owner
 * goes back to the list; once it is ended `onEnded` gets the event as it is now.
 */
export function EventStatePanel({
  event,
  zone,
  onEnded,
}: {
  event: EventView;
  zone: string;
  onEnded: (ended: EventView) => void;
}) {
  const t = useTranslations("events");
  const tAll = useTranslations();
  const api = useApi();
  const router = useRouter();
  const [current, setCurrent] = useState(event);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [deleting, setDeleting] = useState(false);
  const params = { params: { path: { id: event.id } } };
  const knownError = eventErrorKey(error);
  const line = eventStateLine(current, zone);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function endNow() {
    const { data } = await api.POST("/api/events/{id}/end", params);
    if (!data) throw new Error("empty response");
    setCurrent(data);
    onEnded(data);
  }

  async function remove() {
    await api.DELETE("/api/events/{id}", params);
    router.push(`/dashboard/cards/${event.card_id}/events`);
  }

  return (
    <div
      data-testid="event-state-panel"
      className="bg-app-surface border-app-border rounded-app-lg shadow-app-sm flex flex-col gap-3.5 border p-6 @max-[847px]:p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-app-display text-xl font-semibold">{t("state.title")}</h2>
        <Badge variant={PHASE_VARIANT[current.phase]} data-testid="event-state-phase">
          {t(`phase.${current.phase}`)}
        </Badge>
      </div>
      <p data-testid="event-state-dates" className="text-app-muted text-sm">
        {t(`state.${line.key}`, line.values)}
      </p>
      <Button asChild variant="secondary" className="w-full">
        <Link href={`/dashboard/cards/${current.card_id}/events/${current.id}/leads`} data-testid="event-state-contacts">
          <Users aria-hidden="true" />
          {t("state.contacts", { count: current.lead_count })}
        </Link>
      </Button>
      {canEndNow(current) ? (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={busy}
          data-testid="event-state-end-now"
          onClick={() => void run(endNow)}
        >
          <Square aria-hidden="true" />
          {t("state.endNow")}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="dangerGhost"
        className="w-full"
        disabled={busy}
        data-testid="event-state-delete"
        onClick={() => setDeleting(true)}
      >
        <Trash2 aria-hidden="true" />
        {t("state.delete")}
      </Button>
      {knownError !== null ? (
        <Alert variant="destructive" data-testid="event-state-error">
          <AlertDescription>{tAll(knownError)}</AlertDescription>
        </Alert>
      ) : error !== null ? (
        <ErrorNotice error={error} />
      ) : null}

      <DeleteEventDialog
        event={current}
        open={deleting}
        onOpenChange={setDeleting}
        onConfirm={() => {
          setDeleting(false);
          void run(remove);
        }}
      />
    </div>
  );
}
