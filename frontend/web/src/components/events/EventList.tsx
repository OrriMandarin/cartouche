"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { groupEvents } from "@/lib/events/groups";
import { formatEventDate, userTimeZone } from "@/lib/events/time";
import type { EventPhase, EventView } from "@/lib/events/types";
import { EventActions } from "./EventActions";

const GROUPS = ["running", "upcoming", "past"] as const satisfies readonly EventPhase[];

const PHASE_VARIANT = {
  running: "success",
  upcoming: "info",
  past: "neutral",
} as const satisfies Record<EventPhase, string>;

function EventRow({ event, zone, onChanged }: { event: EventView; zone: string; onChanged: () => Promise<void> }) {
  const t = useTranslations("events");

  return (
    <li data-testid={`event-row-${event.id}`} className="bg-card space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p data-testid={`event-title-${event.id}`} className="min-w-0 text-lg font-semibold break-words">
          {event.title}
        </p>
        <Badge variant={PHASE_VARIANT[event.phase]} data-testid={`event-phase-${event.id}`}>
          {t(`phase.${event.phase}`)}
        </Badge>
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <p data-testid={`event-start-${event.id}`}>{t("row.starts", { date: formatEventDate(event.starts_at, zone) })}</p>
        <p data-testid={`event-end-${event.id}`}>
          {event.ends_at ? t("row.ends", { date: formatEventDate(event.ends_at, zone) }) : t("row.noEnd")}
        </p>
        <p data-testid={`event-lead-count-${event.id}`}>{t("row.leads", { count: event.lead_count })}</p>
      </div>
      <EventActions event={event} onChanged={onChanged} />
    </li>
  );
}

/** spec: EDI-009, EDI-018. The events of a card in three groups by server phase, with the dates in the user's zone. */
export function EventList({ events, onChanged }: { events: EventView[]; onChanged: () => Promise<void> }) {
  const t = useTranslations("events");
  const zone = userTimeZone();
  const groups = groupEvents(events);

  return (
    <div className="space-y-8">
      {GROUPS.map((phase) => (
        <section key={phase} data-testid={`events-group-${phase}`} className="space-y-3">
          <h2 className="text-lg font-semibold">{t(`groups.${phase}`)}</h2>
          {groups[phase].length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">{t("groups.empty")}</p>
          ) : (
            <ul className="space-y-3">
              {groups[phase].map((event) => (
                <EventRow key={event.id} event={event} zone={zone} onChanged={onChanged} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
