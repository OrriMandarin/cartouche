import type { CustomFieldKind, FieldMode, StandardFields } from "./types";

/** The standard fields an owner can ask for, in the order of the form (FRM-017). */
export const STANDARD_FIELDS = [
  "first_name",
  "last_name",
  "birth_date",
  "email",
  "phone",
  "address",
] as const satisfies readonly (keyof StandardFields)[];

/** What a standard field can be (FRM-019). */
export const FIELD_MODES = ["off", "optional", "required"] as const satisfies readonly FieldMode[];

/** The kinds of custom field (FRM-021). */
export const CUSTOM_FIELD_KINDS = [
  "text",
  "long_text",
  "date",
  "number",
  "single_choice",
  "checkbox",
] as const satisfies readonly CustomFieldKind[];

/** Most custom fields an event holds (FRM-032). */
export const MAX_CUSTOM_FIELDS = 30;

/** Most options a single choice field holds (FRM-032). */
export const MAX_OPTIONS = 20;
