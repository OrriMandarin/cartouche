import { describe, expect, test } from "vitest";
import { DEFAULT_PRESET_ID } from "@/lib/theme/presets";
import messages from "../../messages/fr.json";
import { TEMPLATE_IDS } from "./ids";
import { getTemplate, listTemplates, renderTemplate, TEMPLATES } from "./registry";
import { sampleCard, sampleEvents, sampleLabels, sampleUrls } from "./fixtures";

// Defaults the backend applies to a new card (DEFAULT_TEMPLATE, DEFAULT_THEME_PRESET).
const BACKEND_DEFAULT_TEMPLATE = "classique";
const BACKEND_DEFAULT_THEME_PRESET = "craie";

function hasMessage(key: string): boolean {
  const value = key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
  return typeof value === "string" && value.length > 0;
}

describe("registry", () => {
  test("TPL-008 registry holds exactly TEMPLATE_IDS, including the backend default", () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual([...TEMPLATE_IDS].sort());
    for (const id of TEMPLATE_IDS) expect(TEMPLATES[id].id).toBe(id);
    expect(Object.keys(TEMPLATES)).toContain(BACKEND_DEFAULT_TEMPLATE);
    expect(DEFAULT_PRESET_ID).toBe(BACKEND_DEFAULT_THEME_PRESET);
  });

  test("TPL-015 unknown template renders as Classique", () => {
    expect(getTemplate("retire").id).toBe("classique");
    expect(getTemplate("toString").id).toBe("classique");
    expect(getTemplate("classique").id).toBe("classique");
  });

  test("TPL-007 every template is listed for everyone", () => {
    expect(listTemplates()).toHaveLength(TEMPLATE_IDS.length);
  });

  test("EDI-011 every template label is translated", () => {
    for (const template of listTemplates()) {
      const keys = [template.nameKey];
      for (const field of template.settings.fields) {
        keys.push(field.labelKey);
        if (field.kind === "select") keys.push(...field.options.map((option) => option.labelKey));
      }
      for (const key of keys) expect(hasMessage(key), key).toBe(true);
    }
  });

  test("TPL-016 TPL-019 renderTemplate reads settings and theme through their parsers", () => {
    const element = renderTemplate({
      template: "retire",
      settings: { links_layout: "grille", animate_events: "oui", unknown: 1 },
      theme: { preset: "retire" },
      card: sampleCard,
      events: sampleEvents,
      urls: sampleUrls,
      labels: sampleLabels,
      mode: "public",
    });
    const props = element.props as { settings: unknown; theme: { presetId: string } };
    expect(props.settings).toEqual({ links_layout: "list", animate_events: true });
    expect(props.theme.presetId).toBe("craie");
  });
});
