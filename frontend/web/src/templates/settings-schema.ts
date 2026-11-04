export type SettingsField =
  | {
      kind: "select";
      key: string;
      labelKey: string;
      /** `summaryKey`: how the option reads in the folded template section of the phone editor (EDI-003). */
      options: { value: string; labelKey: string; summaryKey?: string }[];
      default: string;
    }
  | { kind: "boolean"; key: string; labelKey: string; default: boolean }
  | {
      kind: "range";
      key: string;
      labelKey: string;
      min: number;
      max: number;
      step: number;
      default: number;
    }
  | { kind: "color"; key: string; labelKey: string; default: string };

/** The settings a template exposes; the editor builds its form from it (TPL-004). */
export interface SettingsSchema {
  fields: SettingsField[];
}

export type SettingsValues = Record<string, string | number | boolean>;

const COLOR = /^#[0-9a-fA-F]{6}$/;

function parseField(field: SettingsField, value: unknown): string | number | boolean {
  switch (field.kind) {
    case "select":
      return typeof value === "string" && field.options.some((option) => option.value === value)
        ? value
        : field.default;
    case "boolean":
      return typeof value === "boolean" ? value : field.default;
    case "range":
      return typeof value === "number" && Number.isFinite(value) && value >= field.min && value <= field.max
        ? value
        : field.default;
    case "color":
      return typeof value === "string" && COLOR.test(value) ? value.toLowerCase() : field.default;
  }
}

/**
 * Reads stored settings through a template's schema at render time (TPL-016): an unknown key is
 * dropped and an absent or invalid value takes the default, so a bad setting never fails a page.
 */
export function parseSettings(schema: SettingsSchema, raw: unknown): SettingsValues {
  const input =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const values: SettingsValues = {};
  for (const field of schema.fields) {
    values[field.key] = parseField(field, Object.hasOwn(input, field.key) ? input[field.key] : undefined);
  }
  return values;
}
