"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { leadsInScope } from "@/lib/events/contacts-scope";
import { countLeads } from "@/lib/events/export-count";
import { applyLeadChange, type LeadActions, type LeadChange } from "@/lib/events/lead-actions";
import { filterLeads } from "@/lib/events/lead-search";
import { leadHeading } from "@/lib/events/leads";
import { formatLeadRowDate, userTimeZone } from "@/lib/events/time";
import type { LeadView } from "@/lib/events/types";
import { cn } from "@/lib/utils";
import { LeadDetail } from "./LeadDetail";

/** Something the list places on the page, possibly built from the contacts once loaded (`null` while loading). */
export type LeadListSlot = ReactNode | ((leads: LeadView[] | null) => ReactNode);

// One markup, two layouts: columns from 848 px of container (the side bar and 600 px of content), compact rows below.
const WIDE_COLUMNS_WITH_EVENT =
  "@min-[848px]:grid-cols-[150px_minmax(0,1fr)_minmax(0,1.25fr)_150px_minmax(0,1fr)_72px]";
const WIDE_COLUMNS = "@min-[848px]:grid-cols-[150px_minmax(0,1fr)_minmax(0,1.25fr)_150px_72px]";
const NOT_ORDERED = "@min-[848px]:order-none @min-[848px]:col-span-1";

function LeadRow({
  lead,
  zone,
  showEvent,
  onOpen,
}: {
  lead: LeadView;
  zone: string;
  showEvent: boolean;
  onOpen: (lead: LeadView) => void;
}) {
  const t = useTranslations("leads");
  const heading = leadHeading(lead);
  const quiet = lead.spam ? "text-app-muted" : "";
  // LEA-017: a lead titled by its email does not repeat it.
  const email = heading.kind === "name" ? lead.answers.email : null;

  return (
    <li
      data-testid={`lead-row-${lead.id}`}
      className={cn(
        "border-app-border grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b px-4 py-2.5 text-sm last:border-b-0",
        "@min-[848px]:min-h-[60px] @min-[848px]:gap-x-4 @min-[848px]:px-5 @min-[848px]:py-0",
        showEvent ? WIDE_COLUMNS_WITH_EVENT : WIDE_COLUMNS,
      )}
    >
      <span
        data-testid={`lead-date-${lead.id}`}
        className={cn(
          "text-app-muted order-2 text-right text-[13px] tabular-nums @min-[848px]:text-left @min-[848px]:text-sm",
          NOT_ORDERED,
        )}
      >
        {formatLeadRowDate(lead.submitted_at, zone)}
      </span>
      <span className={cn("order-1 min-w-0", NOT_ORDERED)}>
        <button
          type="button"
          data-testid={`lead-open-${lead.id}`}
          onClick={() => onOpen(lead)}
          className={cn(
            "rounded-app-sm inline-flex min-h-8 max-w-full items-center text-[15px] font-[650] hover:underline @min-[848px]:min-h-11",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-ring)]",
            quiet,
          )}
        >
          <span data-testid={`lead-name-${lead.id}`} className="truncate">
            {heading.kind === "unnamed" ? t("unnamed") : heading.text}
          </span>
        </button>
      </span>
      <span className={cn("order-3 col-span-2 min-w-0 truncate", NOT_ORDERED, quiet)}>
        {email ? <span data-testid={`lead-email-${lead.id}`}>{email}</span> : <span aria-hidden="true">—</span>}
      </span>
      <span
        className={cn("text-app-muted order-4 tabular-nums @min-[848px]:text-app-text @min-[848px]:whitespace-nowrap", NOT_ORDERED)}
      >
        {lead.phone_display ? <span data-testid={`lead-phone-${lead.id}`}>{lead.phone_display}</span> : <span aria-hidden="true">—</span>}
      </span>
      {showEvent ? (
        <span
          data-testid={`lead-event-${lead.id}`}
          className="text-app-muted hidden min-w-0 truncate @min-[848px]:block"
        >
          {lead.event_title}
        </span>
      ) : null}
      <span className={cn("order-5 justify-self-end", NOT_ORDERED)}>
        {lead.spam ? (
          <Badge variant="danger" data-testid={`lead-spam-badge-${lead.id}`}>
            {t("spamBadge")}
          </Badge>
        ) : null}
      </span>
    </li>
  );
}

function LeadTableHead({ showEvent }: { showEvent: boolean }) {
  const t = useTranslations("leads.columns");
  return (
    <div
      aria-hidden="true"
      className={cn(
        "border-app-border text-app-muted hidden min-h-[42px] items-center gap-x-4 border-b px-5 text-xs font-bold tracking-[0.06em] uppercase @min-[848px]:grid",
        showEvent ? WIDE_COLUMNS_WITH_EVENT : WIDE_COLUMNS,
      )}
    >
      <span>{t("date")}</span>
      <span>{t("name")}</span>
      <span>{t("email")}</span>
      <span>{t("phone")}</span>
      {showEvent ? <span>{t("event")}</span> : null}
      <span />
    </div>
  );
}

/**
 * spec: EDI-020, LEA-002, LEA-003, LEA-014 to LEA-017, LEA-020, LEA-034, ABU-003, ABU-004, ABU-009, ABU-010. A table
 * of contacts, loaded once, with the search and the detail sheet (which has the spam mark and the deletion when
 * `actions` is given). After a successful action the list is updated from the answer, never reloaded. `load` is
 * called once, on mount, whatever function the parent passes on later renders (give the list a new `key` to load
 * again). `showEvent` adds the event of each contact (whole-card view). The list only shows the contacts of
 * `eventId` when given (EDI-031). `toolbar` goes above the list, `controls` before the search, `scopeBar` between
 * the search and the table, and `empty` replaces the default text when there is no contact to show.
 */
export function LeadList({
  load,
  actions,
  showEvent,
  eventId = null,
  toolbar,
  controls,
  scopeBar,
  empty,
}: {
  load: () => Promise<LeadView[]>;
  actions: LeadActions | null;
  showEvent: boolean;
  eventId?: string | null;
  toolbar?: LeadListSlot;
  controls?: LeadListSlot;
  scopeBar?: (leads: LeadView[]) => ReactNode;
  empty?: ReactNode;
}) {
  const t = useTranslations("leads");
  const zone = userTimeZone();
  const [leads, setLeads] = useState<LeadView[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  // The latest `load`, so that a new function on each render of the parent never triggers another request.
  const latestLoad = useRef(load);
  useEffect(() => {
    latestLoad.current = load;
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    async function fetchLeads() {
      try {
        const loaded = await latestLoad.current();
        if (cancelled) return;
        setLeads(loaded);
        setLoadError(null);
      } catch (e) {
        if (!cancelled) setLoadError(e);
      }
    }
    // The promise never rejects: fetchLeads catches its own errors.
    void fetchLeads();
    return () => {
      cancelled = true;
    };
  }, []);

  function applyChange(change: LeadChange) {
    setLeads((current) => (current === null ? current : applyLeadChange(current, change)));
  }

  const place = (slot: LeadListSlot) => (typeof slot === "function" ? slot(leads) : slot);
  const inScope = leads === null ? [] : leadsInScope(leads, eventId);
  const shown = filterLeads(inScope, query);
  const openLead = leads?.find((lead) => lead.id === openId) ?? null;
  const counts = countLeads(shown);

  return (
    <div className="flex flex-1 flex-col gap-5 @max-[847px]:gap-3">
      {place(toolbar)}
      {loadError !== null ? <ErrorNotice error={loadError} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        {place(controls)}
        {inScope.length > 0 ? (
          <div className="relative flex min-w-[220px] flex-1 items-center">
            <Search aria-hidden="true" className="text-app-muted pointer-events-none absolute left-3 size-5" />
            <Label htmlFor="leads-search" className="sr-only">
              {t("search")}
            </Label>
            <Input
              id="leads-search"
              type="search"
              data-testid="leads-search"
              className="pl-[42px]"
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        ) : null}
      </div>
      {leads === null ? (
        loadError === null ? (
          <p data-testid="leads-loading" className="text-app-muted py-6 text-center">
            {t("loading")}
          </p>
        ) : null
      ) : (
        <>
          {leads.length > 0 && scopeBar ? scopeBar(leads) : null}
          {inScope.length === 0 ? (
            (empty ?? (
              <p data-testid="leads-empty" className="text-app-muted rounded-app-lg border border-dashed p-4 text-sm">
                {t("empty")}
              </p>
            ))
          ) : (
            <>
              <p data-testid="leads-count" className="text-app-muted text-[13px] leading-[1.4]">
                {t("summary", counts)}
              </p>
              {shown.length === 0 ? (
                <p
                  data-testid="leads-no-match"
                  className="text-app-muted rounded-app-lg border border-dashed p-4 text-sm"
                >
                  {t("noMatch")}
                </p>
              ) : (
                <div className="bg-app-surface border-app-border rounded-app-lg shadow-app-sm overflow-hidden border">
                  <LeadTableHead showEvent={showEvent} />
                  <ul data-testid="leads-list">
                    {shown.map((lead) => (
                      <LeadRow
                        key={lead.id}
                        lead={lead}
                        zone={zone}
                        showEvent={showEvent}
                        onOpen={(target) => setOpenId(target.id)}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </>
      )}

      {openLead ? (
        <LeadDetail lead={openLead} zone={zone} actions={actions} onChange={applyChange} onClose={() => setOpenId(null)} />
      ) : null}
    </div>
  );
}
