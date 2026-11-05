// How a link of a card is shown: icon, name, address, accessible name (PUB-035, PUB-036), and the
// initials of the avatar placeholder (PUB-023). Pure functions shared by the templates.
import { Globe, Link as LinkIcon } from "lucide-react";
import type { ComponentType } from "react";
import type { PublicCard, TemplateLabels } from "./contract";
import {
  FacebookIcon,
  InstagramIcon,
  LinkedInIcon,
  TikTokIcon,
  XIcon,
  YouTubeIcon,
} from "./icons";

type Link = PublicCard["links"][number];
type IconComponent = ComponentType<{ className?: string }>;

export interface Indexed {
  link: Link;
  index: number;
}

const LINK_ICONS: Record<string, IconComponent> = {
  linkedin: LinkedInIcon,
  instagram: InstagramIcon,
  facebook: FacebookIcon,
  tiktok: TikTokIcon,
  youtube: YouTubeIcon,
  x: XIcon,
  website: Globe,
  custom: LinkIcon,
};

/** Icon of a kind of link; a kind this build does not know reads as a website (TPL-016). */
export function linkIcon(kind: string): IconComponent {
  return (Object.hasOwn(LINK_ICONS, kind) && LINK_ICONS[kind]) || Globe;
}

/** The address as people read it: no scheme, no leading `www.`, no trailing slash. */
export function linkAddress(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

/** What a link is called when it has no label of its own; a kind this build does not know reads as a website (TPL-016). */
export function linkName(labels: TemplateLabels, link: Link): string {
  if (link.label) return link.label;
  return Object.hasOwn(labels.links, link.kind) ? labels.links[link.kind] : labels.links.website;
}

/** Accessible name of a link: its name, then its address. */
export function linkAriaLabel(labels: TemplateLabels, link: Link): string {
  return `${linkName(labels, link)} — ${linkAddress(link.url)}`;
}

/** Free-form links get a row of their own; every other kind is an icon. Order and indexes are kept. */
export function splitLinksForIcons(links: readonly Link[]): { icons: Indexed[]; rows: Indexed[] } {
  const icons: Indexed[] = [];
  const rows: Indexed[] = [];
  links.forEach((link, index) => {
    (link.kind === "custom" ? rows : icons).push({ link, index });
  });
  return { icons, rows };
}

/** First letter of the first and last name, uppercase, accents kept. */
export function initials(firstName?: string | null, lastName?: string | null): string {
  return [firstName, lastName]
    .map((name) => [...(name?.trim() ?? "")][0] ?? "")
    .join("")
    .toLocaleUpperCase("fr");
}
