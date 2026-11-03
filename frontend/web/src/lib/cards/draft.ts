import { ApiError, type components } from "@cartouche/api-client";
import type { LinkKind, MediaView, PublicCard } from "@/templates/contract";
import type { ThemeSettings } from "@/lib/theme/presets";
import { getTemplate } from "@/templates/registry";
import { parseSettings } from "@/templates/settings-schema";
import type { CardView } from "./types";

type UpdateCardBody = components["schemas"]["UpdateCardBody"];

// The generated type of a free-form JSON object is `{ [key: string]: never }`; a draft holds any value.
function asSettings(settings: Record<string, unknown>): UpdateCardBody["settings"] {
  return settings as UpdateCardBody["settings"];
}

/** Id of the simulated event of the preview (EDI-005); it never reaches the server (EDI-017). */
export const PREVIEW_EVENT_ID = "preview";

/** Most links a card holds (PUB-022). */
export const MAX_LINKS = 20;

export const CONTENT_FIELDS = [
  "first_name",
  "last_name",
  "job_title",
  "company",
  "description",
  "email",
  "phone",
] as const;

export type ContentField = (typeof CONTENT_FIELDS)[number];

export interface DraftLink {
  kind: LinkKind;
  url: string;
  label: string;
}

/** What the editor holds while the owner types: every text is a string, empty when absent. */
export interface CardDraft {
  slug: string;
  template: string;
  settings: Record<string, unknown>;
  theme: ThemeSettings;
  content: Record<ContentField, string>;
  links: DraftLink[];
  header: MediaView | null;
  avatar: MediaView | null;
}

/** The draft of a card as the server stores it. */
export function draftFromCard(card: CardView): CardDraft {
  const content = Object.fromEntries(
    CONTENT_FIELDS.map((field) => [field, card.content[field] ?? ""]),
  ) as Record<ContentField, string>;
  return {
    slug: card.slug,
    template: card.template,
    settings: card.settings,
    theme: card.theme,
    content,
    links: card.links.map((link) => ({ kind: link.kind, url: link.url, label: link.label ?? "" })),
    header: card.header ?? null,
    avatar: card.avatar ?? null,
  };
}

/** An empty text is an absent one (the server reads it the same way). */
function orNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}

/** The body of `PUT /api/cards/{id}`: the whole card, media included, since a save replaces everything. */
export function draftToUpdateBody(draft: CardDraft): UpdateCardBody {
  return {
    slug: draft.slug.trim(),
    template: draft.template,
    settings: asSettings(draft.settings),
    theme: draft.theme,
    content: Object.fromEntries(CONTENT_FIELDS.map((field) => [field, orNull(draft.content[field])])),
    links: draft.links.map((link) => ({ kind: link.kind, url: link.url, label: orNull(link.label) })),
    header_media_id: draft.header?.id ?? null,
    avatar_media_id: draft.avatar?.id ?? null,
  };
}

/** The address a card is served under, without the `/c/{slug}` part. */
export function publicBaseUrlOf(card: Pick<CardView, "slug" | "public_url">): string {
  const suffix = `/c/${card.slug}`;
  return card.public_url.endsWith(suffix)
    ? card.public_url.slice(0, -suffix.length)
    : new URL(card.public_url).origin;
}

/** The card as the public page would render it with this draft (TPL-014): same shape, same template. */
export function draftToPublicCard(draft: CardDraft, publicBaseUrl: string): PublicCard {
  const content = Object.fromEntries(
    CONTENT_FIELDS.map((field) => [field, orNull(draft.content[field])]),
  ) as Record<ContentField, string | null>;
  return {
    slug: draft.slug,
    public_url: `${publicBaseUrl}/c/${draft.slug}`,
    template: draft.template,
    settings: asSettings(draft.settings),
    theme: draft.theme,
    content: { ...content, phone_display: null },
    links: draft.links.map((link) => ({ kind: link.kind, url: link.url, label: orNull(link.label) })),
    header: draft.header,
    avatar: draft.avatar,
    vcard_url: `/api/public/cards/${encodeURIComponent(draft.slug)}/vcard`,
  };
}

/** Drops `null` and `undefined` members, so an unset override equals an absent one. */
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, member]) => member !== null && member !== undefined)
        .map(([key, member]) => [key, withoutNulls(member)]),
    );
  }
  return value;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((key) =>
      sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }
  return a === b;
}

/** The body as the owner would see it: the settings read through the schema, so a default equals an absent value. */
function effectiveBody(draft: CardDraft): UpdateCardBody {
  const settings = parseSettings(getTemplate(draft.template).settings, draft.settings);
  return { ...draftToUpdateBody(draft), settings: asSettings(settings) };
}

/**
 * Whether the draft differs from what is saved, as the server would see it (EDI-016). A setting set back to
 * its default (R-T17d) or an override cleared is no change.
 */
export function isDirty(saved: CardDraft, current: CardDraft): boolean {
  return !sameValue(withoutNulls(effectiveBody(saved)), withoutNulls(effectiveBody(current)));
}

/**
 * spec: TPL-005. Another template: settings belong to one template's schema, so the new one starts from its
 * defaults (R-T17b).
 */
export function applyTemplateChange(draft: CardDraft, templateId: string): CardDraft {
  return { ...draft, template: templateId, settings: {} };
}

/** Message key of a field error code. */
function errorKey(code: string): string {
  return `fieldErrors.${code}`;
}

/**
 * Message keys by field path (`slug`, `content.email`, `links[0].url`…) for a failed save (EDI-015).
 * A slug that is taken or reserved is a `409` of its own, and belongs to the slug field too.
 */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  if (error.code === "slug_taken" || error.code === "slug_reserved") return { slug: errorKey(error.code) };
  const errors: Record<string, string> = {};
  for (const { field, code } of error.fields) {
    if (!Object.hasOwn(errors, field)) errors[field] = errorKey(code);
  }
  return errors;
}
