"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LeadList } from "@/components/events/LeadList";
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
    <section className="space-y-6">
      <header className="space-y-2">
        <Link href={backHref} data-testid="support-back" className="text-sm underline">
          {t("backToEvents")}
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {subtitle ? (
          <p data-testid="support-leads-subtitle" className="text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </header>
      <Alert role="note" data-testid="support-leads-notice">
        <AlertDescription>{t("notice")}</AlertDescription>
      </Alert>
      <LeadList load={load} actions={null} showEvent={showEvent} />
    </section>
  );
}
