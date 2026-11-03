import type { SettingsSchema } from "../settings-schema";

export interface ClassiqueSettings {
  links_layout: "list" | "icons";
  animate_events: boolean;
}

export const classiqueSettingsSchema: SettingsSchema = {
  fields: [
    {
      kind: "select",
      key: "links_layout",
      labelKey: "templates.classique.settings.links_layout",
      options: [
        { value: "list", labelKey: "templates.classique.settings.links_layout_list" },
        { value: "icons", labelKey: "templates.classique.settings.links_layout_icons" },
      ],
      default: "list",
    },
    {
      kind: "boolean",
      key: "animate_events",
      labelKey: "templates.classique.settings.animate_events",
      default: true,
    },
  ],
};
