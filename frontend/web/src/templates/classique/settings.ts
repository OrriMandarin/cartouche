import type { SettingsSchema } from "../settings-schema";

export interface ClassiqueSettings {
  links_layout: "icons" | "list";
}

/** The single setting of Classique (TPL-027); a stored `animate_events` is ignored (TPL-016). */
export const classiqueSettingsSchema: SettingsSchema = {
  fields: [
    {
      kind: "select",
      key: "links_layout",
      labelKey: "templates.classique.settings.links_layout",
      options: [
        {
          value: "icons",
          labelKey: "templates.classique.settings.links_layout_icons",
          summaryKey: "templates.classique.settings.links_layout_icons_summary",
        },
        {
          value: "list",
          labelKey: "templates.classique.settings.links_layout_list",
          summaryKey: "templates.classique.settings.links_layout_list_summary",
        },
      ],
      default: "icons",
    },
  ],
};
