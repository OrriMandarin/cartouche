"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatEventDate, userTimeZone } from "@/lib/events/time";
import type { EventPhase, EventView } from "@/lib/events/types";

const PHASE_VARIANT = {
  running: "success",
  upcoming: "info",
  past: "neutral",
} as const satisfies Record<EventPhase, string>;

/**
 * spec: ADM-016, EDI-018. The events of a card, read-only (no create, edit, end or delete), each one linking to its
 * contacts, and the whole-card view of the card's contacts. Dates are in the administrator's zone.
 */
export function SupportEventList({ cardId, events }: { cardId: string; events: EventView[] }) {
  const t = useTranslations("support.events");
  const tEvents = useTranslations("events");
  const zone = userTimeZone();

  return (
    <div className="flex flex-col gap-4">
      <Button asChild variant="secondary" size="sm" className="w-fit">
        <Link href={`/support/cards/${cardId}/leads`} data-testid="support-card-leads">
          {t("allLeads")}
        </Link>
      </Button>
      {events.length === 0 ? (
        <p data-testid="support-events-empty" className="text-app-muted rounded-app-lg border border-dashed p-4 text-sm">
          {t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {events.map((event) => (
            <li key={event.id} data-testid={`support-event-row-${event.id}`} className="bg-app-surface border-app-border rounded-app-lg shadow-app-sm flex flex-col gap-3 border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 text-lg font-semibold break-words">{event.title}</p>
                <Badge variant={PHASE_VARIANT[event.phase]}>{tEvents(`phase.${event.phase}`)}</Badge>
              </div>
              <div className="text-app-muted flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <p>{tEvents("row.starts", { date: formatEventDate(event.starts_at, zone) })}</p>
                <p>
                  {event.ends_at ? tEvents("row.ends", { date: formatEventDate(event.ends_at, zone) }) : tEvents("row.noEnd")}
                </p>
                <p>{tEvents("row.leads", { count: event.lead_count })}</p>
              </div>
              <Button asChild size="sm" variant="secondary" className="w-fit">
                <Link
                  href={`/support/cards/${cardId}/events/${event.id}/leads`}
                  data-testid={`support-event-leads-${event.id}`}
                >
                  {t("leads")}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
