"use client";

import { Calendar, Info, Plus, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { groupEvents } from "@/lib/events/groups";
import { runningLimitReached } from "@/lib/events/limit";
import { formatEventDate, userTimeZone } from "@/lib/events/time";
import type { EventPhase, EventView } from "@/lib/events/types";
import { EventActions } from "./EventActions";

const GROUPS = ["running", "upcoming", "past"] as const satisfies readonly EventPhase[];

const PHASE_VARIANT = {
  running: "success",
  upcoming: "info",
  past: "neutral",
} as const satisfies Record<EventPhase, string>;

// One markup, two layouts: a table row from 848 px of container (the side bar and 600 px of content), a card below.
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 @min-[848px]:grid-cols-[minmax(0,1fr)_202px_88px_112px_288px] @min-[848px]:items-center @min-[848px]:gap-x-2 @min-[848px]:px-4";

function DateLine({ label, testId, children }: { label: string; testId: string; children: string }) {
  return (
    <span>
      <b className="text-app-muted inline-block w-11 font-medium">{label}</b>
      <span data-testid={testId}>{children}</span>
    </span>
  );
}

function EventRow({ event, zone, onChanged }: { event: EventView; zone: string; onChanged: () => Promise<void> }) {
  const t = useTranslations("events");
  const base = `/dashboard/cards/${event.card_id}/events/${event.id}`;

  return (
    <li
      data-testid={`event-row-${event.id}`}
      className={`${ROW_GRID} bg-app-surface border-app-border border-b p-4 last:border-b-0 @min-[848px]:min-h-[88px] @min-[848px]:py-0`}
    >
      <div className="order-1 flex min-w-0 flex-col">
        <Link
          href={base}
          data-testid={`event-title-${event.id}`}
          className="focus-visible:outline-app-ring text-base font-[650] break-words hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {event.title}
        </Link>
        <span className="text-app-muted text-[13px]">
          {event.access_code ? t("row.accessCode", { code: event.access_code }) : t("row.noAccessCode")}
        </span>
      </div>
      <div className="order-2 @min-[848px]:order-3">
        <Badge variant={PHASE_VARIANT[event.phase]} data-testid={`event-phase-${event.id}`}>
          {t(`phase.${event.phase}`)}
        </Badge>
      </div>
      <div className="order-3 col-span-2 flex flex-col text-sm leading-[1.45] @min-[848px]:order-2 @min-[848px]:col-span-1">
        <DateLine label={t("row.start")} testId={`event-start-${event.id}`}>
          {formatEventDate(event.starts_at, zone)}
        </DateLine>
        <DateLine label={t("row.end")} testId={`event-end-${event.id}`}>
          {event.ends_at ? formatEventDate(event.ends_at, zone) : t("row.noEnd")}
        </DateLine>
      </div>
      <Link
        href={`${base}/leads`}
        data-testid={`event-contacts-${event.id}`}
        className="focus-visible:outline-app-ring order-4 col-span-2 inline-flex min-h-9 items-center text-sm font-semibold underline underline-offset-3 focus-visible:outline-2 focus-visible:outline-offset-2 @min-[848px]:col-span-1 @min-[848px]:min-h-11"
      >
        <span data-testid={`event-lead-count-${event.id}`}>{t("row.leads", { count: event.lead_count })}</span>
      </Link>
      <div className="order-5 col-span-2 @min-[848px]:col-span-1">
        <EventActions event={event} onChanged={onChanged} />
      </div>
    </li>
  );
}

function Notice({
  tone,
  Icon,
  testId,
  className = "",
  children,
}: {
  tone: "warning" | "info";
  Icon: typeof Info;
  testId: string;
  className?: string;
  children: React.ReactNode;
}) {
  const colors = tone === "warning" ? "bg-app-warning-soft text-app-warning" : "bg-app-info-soft text-app-info";
  return (
    <div
      role="status"
      data-testid={testId}
      className={`${colors} rounded-app flex items-start gap-3 px-4 py-3 text-[15px] leading-normal ${className}`}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <p className="text-app-text">{children}</p>
    </div>
  );
}

function EventListEmpty({ newEventHref }: { newEventHref: string }) {
  const t = useTranslations("events.empty");
  return (
    <div
      data-testid="events-empty"
      className="flex flex-1 flex-col items-center justify-center gap-3.5 px-3 py-6 text-center"
    >
      <div className="bg-app-surface-2 text-app-muted grid size-[72px] place-items-center rounded-full">
        <Calendar aria-hidden="true" className="size-[30px]" />
      </div>
      <h2 className="font-app-display text-[26px] leading-[1.15] font-semibold">{t("title")}</h2>
      <p className="text-app-muted max-w-[52ch]">{t("text")}</p>
      <Button asChild className="mt-1.5 @max-[847px]:w-full">
        <Link href={newEventHref} data-testid="new-event-empty">
          <Plus aria-hidden="true" />
          {t("create")}
        </Link>
      </Button>
    </div>
  );
}

/**
 * spec: EDI-009, EDI-018, EDI-032. The events of a card in three groups by server phase (a group without event is
 * left out), with the dates in the user's zone. `max` is the instance's limit of events in progress per card.
 */
export function EventList({
  events,
  max,
  newEventHref,
  onChanged,
}: {
  events: EventView[];
  max: number;
  newEventHref: string;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("events");
  const zone = userTimeZone();
  const groups = groupEvents(events);

  if (events.length === 0) return <EventListEmpty newEventHref={newEventHref} />;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {runningLimitReached(events, max) ? (
          <Notice tone="warning" Icon={TriangleAlert} testId="events-limit">
            <b>{t("limit.title", { max })}</b> {t("limit.body")}
          </Notice>
        ) : null}
        <Notice tone="info" Icon={Info} testId="events-info" className="@max-[847px]:hidden">
          {t("info", { max })}
        </Notice>
      </div>
      {GROUPS.filter((phase) => groups[phase].length > 0).map((phase) => (
        <section
          key={phase}
          data-testid={`events-group-${phase}`}
          aria-labelledby={`events-group-title-${phase}`}
          className="flex flex-col gap-2.5"
        >
          <div className="flex items-center gap-2.5">
            <h2 id={`events-group-title-${phase}`} className="text-xl font-[650]">
              {t(`groups.${phase}`)}
            </h2>
            <Badge variant="neutral" className="before:hidden">
              {groups[phase].length}
            </Badge>
          </div>
          <div className="@min-[848px]:bg-app-surface @min-[848px]:border-app-border @min-[848px]:rounded-app-lg @min-[848px]:shadow-app-sm @min-[848px]:overflow-hidden @min-[848px]:border">
            <div
              aria-hidden="true"
              className={`${ROW_GRID} text-app-muted border-app-border hidden min-h-10 border-b text-xs font-bold tracking-[.06em] uppercase @min-[848px]:grid`}
            >
              <span>{t("columns.event")}</span>
              <span>{t("columns.dates")}</span>
              <span>{t("columns.state")}</span>
              <span>{t("columns.contacts")}</span>
              <span />
            </div>
            <ul className="@max-[847px]:border-app-border @max-[847px]:rounded-app-lg @max-[847px]:shadow-app-sm @max-[847px]:overflow-hidden @max-[847px]:border">
              {groups[phase].map((event) => (
                <EventRow key={event.id} event={event} zone={zone} onChanged={onChanged} />
              ))}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}
