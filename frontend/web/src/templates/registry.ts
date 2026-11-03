import { createElement, type ReactElement } from "react";
import { resolveTheme } from "@/lib/theme/resolve";
import type { PublicCard, PublicEvent, TemplateDefinition, TemplateLabels, TemplateProps } from "./contract";
import { classique } from "./classique";
import { TEMPLATE_IDS, type TemplateId } from "./ids";
import { parseSettings } from "./settings-schema";

// The settings type differs per template, so the registry erases it; renderTemplate parses them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTemplate = TemplateDefinition<any>;

export const TEMPLATES: Record<TemplateId, AnyTemplate> = { classique };

const FALLBACK_TEMPLATE: TemplateId = "classique";

/** The template of that id; an unknown one (for example removed from the repository) is Classique (TPL-015). */
export function getTemplate(id: string): AnyTemplate {
  return Object.hasOwn(TEMPLATES, id) ? TEMPLATES[id as TemplateId] : TEMPLATES[FALLBACK_TEMPLATE];
}

/** Every template, for everyone (TPL-007). */
export function listTemplates(): AnyTemplate[] {
  return TEMPLATE_IDS.map((id) => TEMPLATES[id]);
}

export interface RenderTemplateInput {
  /** Template id as stored on the card. */
  template: string;
  /** Settings as stored on the card. */
  settings: unknown;
  /** Theme as stored on the card. */
  theme: unknown;
  card: PublicCard;
  events: PublicEvent[];
  urls: TemplateProps<unknown>["urls"];
  labels: TemplateLabels;
  mode: TemplateProps<unknown>["mode"];
}

/** Renders a card with its template, reading settings and theme through their safe parsers (TPL-016, TPL-019). */
export function renderTemplate({ template, settings, theme, ...rest }: RenderTemplateInput): ReactElement {
  const definition = getTemplate(template);
  return createElement(definition.Component, {
    ...rest,
    settings: parseSettings(definition.settings, settings),
    theme: resolveTheme(theme),
  });
}
