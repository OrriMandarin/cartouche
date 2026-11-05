import type { TemplateDefinition } from "../contract";
import { Classique } from "./Classique";
import { classiqueSettingsSchema, type ClassiqueSettings } from "./settings";

export const classique: TemplateDefinition<ClassiqueSettings> = {
  id: "classique",
  nameKey: "templates.classique.name",
  descriptionKey: "templates.classique.description",
  beta: false,
  supportsTheme: true,
  media: { header: ["image", "video"], avatar: true },
  settings: classiqueSettingsSchema,
  Component: Classique,
};
