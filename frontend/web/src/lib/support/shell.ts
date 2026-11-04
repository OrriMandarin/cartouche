import type { BackAction, Crumb } from "@/components/shell/TopBar";

export type SupportPage =
  | { kind: "home" }
  | { kind: "user" }
  | { kind: "card" }
  | { kind: "events" | "cardLeads" | "eventLeads"; cardId: string };

export type SupportLabels = { support: string; user: string; card: string; events: string; contacts: string };

/**
 * spec: ADM-001. The title (phone app bar), breadcrumb (computer top bar) and back action of a support page, so that
 * every support page says where it is and leads one level up.
 */
export function supportShellSlots(
  page: SupportPage,
  labels: SupportLabels,
): { title: string; breadcrumb: Crumb[]; back?: BackAction } {
  const support: Crumb = { label: labels.support, href: "/support" };
  switch (page.kind) {
    case "home":
      return { title: labels.support, breadcrumb: [{ label: labels.support }] };
    case "user":
    case "card":
      return {
        title: page.kind === "user" ? labels.user : labels.card,
        breadcrumb: [support, { label: page.kind === "user" ? labels.user : labels.card }],
        back: { href: "/support", label: labels.support },
      };
    case "events": {
      const cardHref = `/support/cards/${page.cardId}`;
      return {
        title: labels.events,
        breadcrumb: [support, { label: labels.card, href: cardHref }, { label: labels.events }],
        back: { href: cardHref, label: labels.card },
      };
    }
    case "cardLeads":
    case "eventLeads": {
      const cardHref = `/support/cards/${page.cardId}`;
      const eventsHref = `${cardHref}/events`;
      return {
        title: labels.contacts,
        breadcrumb: [
          support,
          { label: labels.card, href: cardHref },
          { label: labels.events, href: eventsHref },
          { label: labels.contacts },
        ],
        back: { href: eventsHref, label: labels.events },
      };
    }
  }
}
