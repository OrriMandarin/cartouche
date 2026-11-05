"use client";

import { ChevronDown, Download } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { CardView } from "@/lib/cards/types";
import { contactsHref, leadsInScope, type ScopeTab } from "@/lib/events/contacts-scope";
import { countLeads } from "@/lib/events/export-count";
import type { LeadView } from "@/lib/events/types";
import { useShellSlots } from "@/components/shell/AppShell";
import { cn } from "@/lib/utils";
import { ExportDialogPanel } from "./ExportDialog";

const SELECT_CLASS =
  "border-app-border-strong bg-app-surface rounded-app flex min-h-11 cursor-pointer items-center justify-between gap-2 border pr-2.5 pl-3 text-left text-[15px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-ring)]";

/** spec: EDI-031. The card whose contacts are listed: a menu of the user's cards, the address carries the choice. */
export function CardSelect({ cards, card }: { cards: CardView[]; card: CardView }) {
  const t = useTranslations("contactsPage");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={SELECT_CLASS} aria-label={t("cardLabel")} data-testid="contacts-card-select">
        <span>{t.rich("card", { slug: card.slug, b: (chunks) => <b>{chunks}</b> })}</span>
        <ChevronDown aria-hidden="true" className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {cards.map((option) => (
          <DropdownMenuItem key={option.id} asChild>
            <Link href={contactsHref(option.id, null)} replace scroll={false} data-testid={`contacts-card-option-${option.id}`}>
              {option.slug}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function tabTitle(tab: ScopeTab, all: string): string {
  return tab.title ?? all;
}

/** spec: EDI-031. Computers: the whole card and each event as tabs, with the contacts each one holds. */
export function ScopeTabs({ cardId, tabs, eventId }: { cardId: string; tabs: ScopeTab[]; eventId: string | null }) {
  const t = useTranslations("leads.scope");
  return (
    <nav
      aria-label={t("label")}
      className="border-app-border hidden gap-1 overflow-x-auto border-b @min-[848px]:flex"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.eventId ?? "all"}
          href={contactsHref(cardId, tab.eventId)}
          replace
          scroll={false}
          aria-current={tab.eventId === eventId ? "true" : undefined}
          data-testid={`contacts-scope-tab-${tab.eventId ?? "all"}`}
          className={cn(
            "text-app-muted -mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-semibold whitespace-nowrap",
            "aria-[current=true]:border-app-text aria-[current=true]:text-app-text",
            "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--app-ring)]",
          )}
        >
          {tabTitle(tab, t("all"))} <span className="font-medium">{tab.count}</span>
        </Link>
      ))}
    </nav>
  );
}

/** spec: EDI-031. Phones: the same scopes as a menu. */
export function ScopeMenu({ cardId, tabs, eventId }: { cardId: string; tabs: ScopeTab[]; eventId: string | null }) {
  const t = useTranslations("leads.scope");
  const current = tabs.find((tab) => tab.eventId === eventId) ?? tabs[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(SELECT_CLASS, "min-w-0 flex-1 @min-[848px]:hidden")}
        aria-label={t("select")}
        data-testid="contacts-scope-select"
      >
        <span className="truncate">{current ? tabTitle(current, t("all")) : null}</span>
        <ChevronDown aria-hidden="true" className="size-5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {tabs.map((tab) => (
          <DropdownMenuItem key={tab.eventId ?? "all"} asChild>
            <Link
              href={contactsHref(cardId, tab.eventId)}
              replace
              scroll={false}
              data-testid={`contacts-scope-option-${tab.eventId ?? "all"}`}
            >
              {tabTitle(tab, t("all"))} <span className="text-app-muted ml-auto">{tab.count}</span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * spec: EDI-031, LEA-035. The title of the contacts page and its export of the current scope: a button next to the
 * title on computers, an icon in the app bar on phones. Both open the same dialog, which announces the exact count.
 */
export function ContactsHead({
  card,
  eventId,
  eventTitle,
  leads,
}: {
  card: CardView;
  eventId: string | null;
  eventTitle: string | null;
  leads: LeadView[] | null;
}) {
  const t = useTranslations("contactsPage");
  const [open, setOpen] = useState(false);
  const exportable = leads !== null;

  const barAction: ReactNode = exportable ? (
    <Button variant="ghost" size="icon" aria-label={t("exportBar")} data-testid="export-open-bar" onClick={() => setOpen(true)}>
      <Download aria-hidden="true" />
    </Button>
  ) : undefined;
  useShellSlots({ action: barAction });

  return (
    <>
      <div className="hidden flex-wrap items-end justify-between gap-4 @min-[848px]:flex">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-[28px] leading-[1.2] font-bold tracking-[-0.02em]">{t("title")}</h1>
          <p className="text-app-muted">{t("description")}</p>
        </div>
        {exportable ? (
          <Button data-testid="export-open" onClick={() => setOpen(true)}>
            <Download aria-hidden="true" />
            {t("export")}
          </Button>
        ) : null}
      </div>
      {exportable ? (
        <ExportDialogPanel
          scope={eventId === null ? { kind: "card", id: card.id } : { kind: "event", id: eventId }}
          summary={{ cardSlug: card.slug, eventTitle, counts: countLeads(leadsInScope(leads, eventId)) }}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  );
}
