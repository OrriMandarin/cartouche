import { fieldErrorKey } from "@/lib/field-errors";
import type { PublicCustomField } from "./types";

type CustomFieldKind = PublicCustomField["kind"];

const STANDARD_KEYS: Record<string, string> = {
  "answers.first_name:required": "firstNameRequired",
  "answers.last_name:required": "lastNameRequired",
  "answers.birth_date:required": "birthDateRequired",
  "answers.birth_date:invalid_date": "birthDateInvalid",
  "answers.email:required": "emailRequired",
  "answers.email:invalid_email": "emailInvalid",
  "answers.email:too_long": "emailTooLong",
  "answers.phone:required": "phoneRequired",
  "answers.phone:invalid_phone": "phoneInvalid",
  "answers.address.street:required": "streetRequired",
  "answers.address.postal_code:required": "postalCodeRequired",
  "answers.address.city:required": "cityRequired",
  "answers.address.country:required": "countryRequired",
  "consent:required": "consentRequired",
};

const CUSTOM_KEYS: Record<string, string> = {
  "text:required": "textRequired",
  "long_text:required": "textRequired",
  "date:required": "dateRequired",
  "datetime:required": "dateTimeRequired",
  "date:invalid_date": "dateInvalid",
  "datetime:invalid_date": "dateInvalid",
  "number:required": "numberRequired",
  "number:invalid_number": "numberInvalid",
  "single_choice:required": "choiceRequired",
  "single_choice:invalid_choice": "choiceInvalid",
  "checkbox:required": "checkboxRequired",
};

/**
 * Message key of the error `code` of the field at `path` (FRM-046): the form's own wording, which names the
 * field, then the shared `fieldErrors` message for a code it does not word. `kind` is the kind of a custom field.
 */
export function fieldMessageKey(path: string, code: string, kind?: CustomFieldKind): string {
  const own =
    kind === undefined ? STANDARD_KEYS[`${path}:${code}`] : CUSTOM_KEYS[`${kind}:${code}`];
  if (own) return `eventForm.errors.${own}`;
  if (code === "too_long") return "eventForm.errors.tooLong";
  return fieldErrorKey(code);
}

/** How many fields the summary counts: the errors by field path (FRM-046). */
export function errorCount(errors: Record<string, string>): number {
  return Object.keys(errors).length;
}
