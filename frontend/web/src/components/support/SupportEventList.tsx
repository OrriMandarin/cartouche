"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatEventDate, userTimeZone } from "@/lib/events/time";
import type { EventPhase, EventView } from "@/lib/events/types";

const PHASE_VARIANT = {
  running: "default",
  upcoming: "secondary",
  past: "outline",
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
    <div className="space-y-4">
      <Button asChild variant="outline" size="sm">
        <Link href={`/support/cards/${cardId}/leads`} data-testid="support-card-leads">
          {t("allLeads")}
        </Link>
      </Button>
      {events.length === 0 ? (
        <p data-testid="support-events-empty" className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {events.map((event) => (
            <li key={event.id} data-testid={`support-event-row-${event.id}`} className="bg-card space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 text-lg font-semibold break-words">{event.title}</p>
                <Badge variant={PHASE_VARIANT[event.phase]}>{tEvents(`phase.${event.phase}`)}</Badge>
              </div>
              <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <p>{tEvents("row.starts", { date: formatEventDate(event.starts_at, zone) })}</p>
                <p>
                  {event.ends_at ? tEvents("row.ends", { date: formatEventDate(event.ends_at, zone) }) : tEvents("row.noEnd")}
                </p>
                <p>{tEvents("row.leads", { count: event.lead_count })}</p>
              </div>
              <Button asChild size="sm" variant="outline">
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
