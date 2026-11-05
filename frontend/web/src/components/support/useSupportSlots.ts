"use client";

import { useTranslations } from "next-intl";
import { supportShellSlots, type SupportPage } from "@/lib/support/shell";

/** The shell slots (title, breadcrumb, back) of a support page, in the interface language. */
export function useSupportSlots(page: SupportPage) {
  const t = useTranslations("support");
  const tEvents = useTranslations("support.events");
  const tLeads = useTranslations("support.leads");
  return supportShellSlots(page, {
    support: t("title"),
    user: t("crumbs.user"),
    card: t("crumbs.card"),
    events: tEvents("title"),
    contacts: tLeads("title"),
  });
}
