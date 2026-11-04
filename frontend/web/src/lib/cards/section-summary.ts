import { themeSummary } from "@/lib/theme/summary";
import { getTemplate } from "@/templates/registry";
import { parseSettings } from "@/templates/settings-schema";
import { cardDisplayName } from "./display-name";
import type { CardDraft } from "./draft";

/** The sections of the card editor, in the form's order. */
export const EDITOR_SECTIONS = ["identity", "contact", "links", "media", "template", "theme"] as const;

export type EditorSection = (typeof EDITOR_SECTIONS)[number];

/** A message lookup, such as next-intl's `t`, so that the summaries are built and tested outside React. */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

const SEPARATOR = " · ";

function joined(parts: string[], empty: string): string {
  return parts.length > 0 ? parts.join(SEPARATOR) : empty;
}

function linksSummary(draft: CardDraft, t: Translate): string {
  const custom = draft.links.filter((link) => link.kind === "custom").length;
  const networks = draft.links.length - custom;
  const parts = [
    networks > 0 ? t("editor.summary.networks", { count: networks }) : null,
    custom > 0 ? t("editor.summary.customLinks", { count: custom }) : null,
  ].filter((part): part is string => part !== null);
  return joined(parts, t("editor.summary.noLinks"));
}

function mediaSummary(draft: CardDraft, t: Translate): string {
  if (draft.header === null) {
    return t(draft.avatar === null ? "editor.summary.noMedia" : "editor.summary.avatarAlone");
  }
  const header = t(draft.header.kind === "video" ? "editor.summary.headerVideo" : "editor.summary.headerImage");
  return draft.avatar === null ? header : `${header}${SEPARATOR}${t("editor.summary.avatar")}`;
}

function templateSummary(draft: CardDraft, t: Translate): string {
  const template = getTemplate(draft.template);
  const settings = parseSettings(template.settings, draft.settings);
  const parts = [t(template.nameKey)];
  for (const field of template.settings.fields) {
    if (field.kind !== "select") continue;
    const option = field.options.find((candidate) => candidate.value === settings[field.key]);
    if (option?.summaryKey) parts.push(t(option.summaryKey));
  }
  return parts.join(SEPARATOR);
}

/**
 * spec: EDI-003. The line under a folded section of the phone editor: what the section holds, in short.
 */
export function sectionSummary(section: EditorSection, draft: CardDraft, t: Translate): string {
  switch (section) {
    case "identity":
      return cardDisplayName(draft.content) ?? t("cards.untitled");
    case "contact":
      return joined(
        [draft.content.email, draft.content.phone].filter((value) => value.trim() !== ""),
        t("editor.summary.noContact"),
      );
    case "links":
      return linksSummary(draft, t);
    case "media":
      return mediaSummary(draft, t);
    case "template":
      return templateSummary(draft, t);
    case "theme":
      return themeSummary(draft.theme, t);
  }
}
