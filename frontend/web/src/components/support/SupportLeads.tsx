"use client";

import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LeadList } from "@/components/events/LeadList";
import { SupportBackLink } from "./SupportBackLink";
import { SupportTitle } from "./SupportTitle";
import type { LeadView } from "@/lib/events/types";

/**
 * spec: ADM-017, ADM-018, ADM-019. The contacts of an event or of a whole card as support reads them: the owner's
 * list, search and detail view, under the audit notice, with no export, spam mark or deletion. `load` is the one
 * request that obtains the leads, hence the one audit entry; the detail view is built from the list.
 */
export function SupportLeads({
  backHref,
  title,
  subtitle,
  load,
  showEvent,
}: {
  backHref: string;
  title: string;
  subtitle?: string;
  load: () => Promise<LeadView[]>;
  showEvent: boolean;
}) {
  const t = useTranslations("support.leads");

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <SupportBackLink href={backHref}>{t("backToEvents")}</SupportBackLink>
        <SupportTitle>{title}</SupportTitle>
        {subtitle ? (
          <p data-testid="support-leads-subtitle" className="text-app-muted">
            {subtitle}
          </p>
        ) : null}
      </header>
      <Alert variant="info" role="note" data-testid="support-leads-notice">
        <Info aria-hidden="true" />
        <AlertDescription>{t("notice")}</AlertDescription>
      </Alert>
      <LeadList load={load} actions={null} showEvent={showEvent} />
    </section>
  );
}
