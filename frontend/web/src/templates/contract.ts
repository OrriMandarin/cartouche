// Template contract (TPL-002, TPL-014). A template is a plain function component: no hook, no event
// handler, no server-only or browser-only API, so a Server Component (public page) and the client
// preview of the editor render it unchanged. A template may render the client components of `src/templates/`
// (the header video needs state), but stays free of hooks itself. Fixed texts come in through `labels`, translated by the
// caller; the CSS variables of `themeToCssVars` carry the theme.
import type { components } from "@cartouche/api-client";
import type { ReactElement } from "react";
import type { ResolvedTheme } from "@/lib/theme/resolve";
import type { TemplateId } from "./ids";
import type { SettingsSchema } from "./settings-schema";

export type PublicCard = components["schemas"]["PublicCard"];
export type MediaView = components["schemas"]["MediaView"];
export type LinkKind = components["schemas"]["LinkKind"];

export const LINK_KINDS: readonly LinkKind[] = [
  "website",
  "linkedin",
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
  "x",
  "custom",
];

/** An event in progress, shown as a button (PUB-008). */
export interface PublicEvent {
  id: string;
  title: string;
  /** ISO 8601 instant. */
  startsAt: string;
}

/** Fixed texts of a card page, translated by the caller. */
export interface TemplateLabels {
  saveContact: string;
  /** Small label of an event button (PUB-008). */
  eventLive: string;
  /** Accessible name of the contact details list. */
  contacts: string;
  /** Sub-labels of the email and phone rows (PUB-034). */
  emailLabel: string;
  phoneLabel: string;
  /** Accessible name of the list of link rows. */
  linksList: string;
  /** Accessible name of the row of link icons. */
  networks: string;
  /** Pause and play button of a header video. */
  pauseVideo: string;
  playVideo: string;
  /** Name of each kind of link, used when the link has no label of its own. */
  links: Record<LinkKind, string>;
}

export interface TemplateProps<S> {
  card: PublicCard;
  theme: ResolvedTheme;
  settings: S;
  events: PublicEvent[];
  urls: {
    vcard: string;
    eventForm(eventId: string): string;
  };
  labels: TemplateLabels;
  mode: "public" | "preview";
}

export interface TemplateDefinition<S> {
  id: TemplateId;
  /** Message key of the display name. */
  nameKey: string;
  /** Message key of the one-line description shown in the template picker. */
  descriptionKey: string;
  beta: boolean;
  supportsTheme: boolean;
  media: { header: ("image" | "video")[]; avatar: boolean };
  settings: SettingsSchema;
  Component: (props: TemplateProps<S>) => ReactElement;
}

/** Test ids every template sets; the end-to-end tests rely on these only (TPL-003). */
export const TEMPLATE_TEST_IDS = {
  name: "card-name",
  jobTitle: "card-job-title",
  company: "card-company",
  description: "card-description",
  email: "card-email",
  phone: "card-phone",
  avatar: "card-avatar",
  headerImage: "card-header-image",
  headerVideo: "card-header-video",
  /** Header without media: the short accent band (PUB-023). */
  headerEmpty: "card-header-empty",
  /** Avatar without photo: the initials (PUB-023). */
  initials: "card-initials",
  /** Name of an event inside its button. */
  eventName: "card-event-name",
  saveContact: "save-contact",
  link: (index: number) => `card-link-${index}`,
  eventButton: (eventId: string) => `event-button-${eventId}`,
} as const;

/** Loose type of a next-intl translator, so the contract does not depend on its generics. */
type Translate = (key: string) => string;

/** Builds the labels from a translator of the whole message catalogue. */
export function buildTemplateLabels(t: Translate): TemplateLabels {
  const links = Object.fromEntries(
    LINK_KINDS.map((kind) => [kind, t(`publicCard.links.${kind}`)]),
  ) as Record<LinkKind, string>;
  return {
    saveContact: t("publicCard.saveContact"),
    eventLive: t("publicCard.eventLive"),
    contacts: t("publicCard.contacts"),
    emailLabel: t("publicCard.emailLabel"),
    phoneLabel: t("publicCard.phoneLabel"),
    linksList: t("publicCard.linksList"),
    networks: t("publicCard.networks"),
    pauseVideo: t("publicCard.pauseVideo"),
    playVideo: t("publicCard.playVideo"),
    links,
  };
}
