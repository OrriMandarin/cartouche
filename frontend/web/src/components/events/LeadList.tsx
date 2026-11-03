"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Badge } from "@/components/ui/badge";
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
import { leadHeading } from "@/lib/events/leads";
import { formatEventDate, userTimeZone } from "@/lib/events/time";
import type { LeadView } from "@/lib/events/types";

type LeadAction = (lead: LeadView) => Promise<unknown>;

function LeadRow({
  lead,
  zone,
  busy,
  onToggleSpam,
  onDelete,
}: {
  lead: LeadView;
  zone: string;
  busy: boolean;
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
          <Badge variant="destructive" data-testid={`lead-spam-badge-${lead.id}`}>
            {t("spamBadge")}
          </Badge>
        ) : null}
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <p data-testid={`lead-date-${lead.id}`}>{formatEventDate(lead.submitted_at, zone)}</p>
        {lead.answers.email ? <p data-testid={`lead-email-${lead.id}`}>{lead.answers.email}</p> : null}
        {lead.phone_display ? <p data-testid={`lead-phone-${lead.id}`}>{lead.phone_display}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
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
      </div>
    </li>
  );
}

/**
 * spec: EDI-020, ABU-003, ABU-004, ABU-009, ABU-010. The contacts of an event, newest first as the API gives them,
 * with the spam flag and the deletion (after a confirmation). The buttons stay disabled from the click until the
 * list is reloaded.
 */
export function LeadList({ eventId }: { eventId: string }) {
  const t = useTranslations("leads");
  const api = useApi();
  const zone = userTimeZone();
  const [leads, setLeads] = useState<LeadView[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<LeadView | null>(null);
  const latestRequest = useRef(0);

  // Resolves once the list is reloaded (never rejects).
  const reload = useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const { data } = await api.GET("/api/events/{id}/leads", { params: { path: { id: eventId } } });
      if (!data) throw new Error("empty response");
      if (request !== latestRequest.current) return; // a newer reload superseded this one
      setLeads(data.leads);
      setError(null);
    } catch (e) {
      if (request === latestRequest.current) setError(e);
    }
  }, [api, eventId]);

  useEffect(() => {
    void (async () => {
      await reload();
    })();
  }, [reload]);

  async function run(action: LeadAction, lead: LeadView) {
    setBusy(true);
    setError(null);
    try {
      await action(lead);
    } catch (e) {
      setError(e);
      setBusy(false);
      return;
    }
    try {
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const setSpam: LeadAction = (lead) =>
    api.PUT("/api/leads/{id}/spam", { params: { path: { id: lead.id } }, body: { spam: !lead.spam } });
  const remove: LeadAction = (lead) => api.DELETE("/api/leads/{id}", { params: { path: { id: lead.id } } });

  return (
    <div className="space-y-4">
      {error !== null ? <ErrorNotice error={error} /> : null}
      {leads === null ? (
        error === null ? (
          <p data-testid="leads-loading" className="text-muted-foreground py-6 text-center">
            {t("loading")}
          </p>
        ) : null
      ) : leads.length === 0 ? (
        <p data-testid="leads-empty" className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
          {t("empty")}
        </p>
      ) : (
        <ul data-testid="leads-list" className="space-y-3">
          {leads.map((lead) => (
            <LeadRow
              key={lead.id}
              lead={lead}
              zone={zone}
              busy={busy}
              onToggleSpam={(target) => void run(setSpam, target)}
              onDelete={setPendingDelete}
            />
          ))}
        </ul>
      )}

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => (open ? undefined : setPendingDelete(null))}>
        <DialogContent closeLabel={t("deleteDialog.close")}>
          <DialogHeader>
            <DialogTitle>{t("deleteDialog.title")}</DialogTitle>
            <DialogDescription>{t("deleteDialog.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" data-testid="lead-delete-cancel" onClick={() => setPendingDelete(null)}>
              {t("deleteDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              data-testid="lead-delete-confirm"
              disabled={busy}
              onClick={() => {
                const target = pendingDelete;
                setPendingDelete(null);
                if (target) void run(remove, target);
              }}
            >
              {t("deleteDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
