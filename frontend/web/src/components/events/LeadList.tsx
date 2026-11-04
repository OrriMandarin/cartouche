"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyLeadChange, type LeadActions, type LeadChange } from "@/lib/events/lead-actions";
import { filterLeads } from "@/lib/events/lead-search";
import { leadHeading } from "@/lib/events/leads";
import { formatEventDate, userTimeZone } from "@/lib/events/time";
import type { LeadView } from "@/lib/events/types";
import { LeadDeleteDialog } from "./LeadDeleteDialog";
import { LeadDetail } from "./LeadDetail";
import { useLeadMutations } from "./use-lead-mutations";

function LeadRow({
  lead,
  zone,
  showEvent,
  actions,
  busy,
  onOpen,
  onToggleSpam,
  onDelete,
}: {
  lead: LeadView;
  zone: string;
  showEvent: boolean;
  actions: LeadActions | null;
  busy: boolean;
  onOpen: (lead: LeadView) => void;
  onToggleSpam: (lead: LeadView) => void;
  onDelete: (lead: LeadView) => void;
}) {
  const t = useTranslations("leads");
  const heading = leadHeading(lead);

  return (
    <li data-testid={`lead-row-${lead.id}`} className="bg-card space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p data-testid={`lead-name-${lead.id}`} className="min-w-0 text-lg font-semibold break-words">
          {heading.kind === "unnamed" ? t("unnamed") : heading.text}
        </p>
        {lead.spam ? (
          <Badge variant="danger" data-testid={`lead-spam-badge-${lead.id}`}>
            {t("spamBadge")}
          </Badge>
        ) : null}
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {showEvent ? <p data-testid={`lead-event-${lead.id}`}>{lead.event_title}</p> : null}
        <p data-testid={`lead-date-${lead.id}`}>{formatEventDate(lead.submitted_at, zone)}</p>
        {/* LEA-017: a lead titled by its email does not repeat it. */}
        {heading.kind === "name" && lead.answers.email ? (
          <p data-testid={`lead-email-${lead.id}`}>{lead.answers.email}</p>
        ) : null}
        {lead.phone_display ? <p data-testid={`lead-phone-${lead.id}`}>{lead.phone_display}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" data-testid={`lead-open-${lead.id}`} onClick={() => onOpen(lead)}>
          {t("open")}
        </Button>
        {actions ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              data-testid={`lead-spam-${lead.id}`}
              onClick={() => onToggleSpam(lead)}
            >
              {lead.spam ? t("unmarkSpam") : t("markSpam")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              data-testid={`lead-delete-${lead.id}`}
              onClick={() => onDelete(lead)}
            >
              {t("delete")}
            </Button>
          </>
        ) : null}
      </div>
    </li>
  );
}

/**
 * spec: EDI-020, LEA-002, LEA-003, LEA-014 to LEA-017, LEA-020, ABU-003, ABU-004, ABU-009, ABU-010. A list of
 * contacts, loaded once, with the search, the detail view and (with `actions`) the spam mark and the deletion. After
 * a successful action the list is updated from the answer, never reloaded. `load` is called once, on mount, whatever
 * function the parent passes on later renders (give the list a new `key` to load again). `showEvent` adds the event
 * of each contact (whole-card view); `toolbar` is shown above the list.
 */
export function LeadList({
  load,
  actions,
  showEvent,
  toolbar,
}: {
  load: () => Promise<LeadView[]>;
  actions: LeadActions | null;
  showEvent: boolean;
  toolbar?: ReactNode;
}) {
  const t = useTranslations("leads");
  const zone = userTimeZone();
  const [leads, setLeads] = useState<LeadView[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LeadView | null>(null);

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

  const mutations = useLeadMutations(actions, applyChange);
  const shown = leads === null ? [] : filterLeads(leads, query);
  const openLead = leads?.find((lead) => lead.id === openId) ?? null;

  return (
    <div className="space-y-4">
      {toolbar}
      {loadError !== null ? <ErrorNotice error={loadError} /> : null}
      {mutations.error !== null ? <ErrorNotice error={mutations.error} /> : null}
      {leads === null ? (
        loadError === null ? (
          <p data-testid="leads-loading" className="text-muted-foreground py-6 text-center">
            {t("loading")}
          </p>
        ) : null
      ) : leads.length === 0 ? (
        <p data-testid="leads-empty" className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
          {t("empty")}
        </p>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="leads-search">{t("search")}</Label>
            <Input
              id="leads-search"
              type="search"
              data-testid="leads-search"
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <p data-testid="leads-count" className="text-muted-foreground text-sm">
              {t("count", { count: shown.length })}
            </p>
          </div>
          {shown.length === 0 ? (
            <p data-testid="leads-no-match" className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
              {t("noMatch")}
            </p>
          ) : (
            <ul data-testid="leads-list" className="space-y-3">
              {shown.map((lead) => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  zone={zone}
                  showEvent={showEvent}
                  actions={actions}
                  busy={mutations.busy}
                  onOpen={(target) => setOpenId(target.id)}
                  onToggleSpam={(target) => void mutations.toggleSpam(target)}
                  onDelete={setPendingDelete}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {openLead ? (
        <LeadDetail lead={openLead} zone={zone} actions={actions} onChange={applyChange} onClose={() => setOpenId(null)} />
      ) : null}

      <LeadDeleteDialog
        open={pendingDelete !== null}
        busy={mutations.busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) void mutations.remove(target);
        }}
      />
    </div>
  );
}
