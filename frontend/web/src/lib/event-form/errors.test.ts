import { describe, expect, test } from "vitest";
import messages from "../../../messages/fr.json";
import { errorCount, fieldMessageKey } from "./errors";

function text(key: string): string {
  const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], messages);
  if (typeof value !== "string") throw new Error(`no message ${key}`);
  return value;
}

const CASES: [path: string, code: string, kind: Parameters<typeof fieldMessageKey>[2], message: string][] = [
  ["answers.first_name", "required", undefined, "Indiquez votre prénom."],
  ["answers.last_name", "required", undefined, "Indiquez votre nom."],
  ["answers.birth_date", "required", undefined, "Indiquez votre date de naissance."],
  ["answers.birth_date", "invalid_date", undefined, "Vérifiez la date de naissance."],
  ["answers.email", "required", undefined, "Indiquez votre adresse e-mail."],
  ["answers.email", "invalid_email", undefined, "Vérifiez l’adresse e-mail (exemple : nom@domaine.fr)."],
  ["answers.email", "too_long", undefined, "Cette adresse e-mail est trop longue."],
  ["answers.phone", "required", undefined, "Indiquez votre numéro de téléphone."],
  ["answers.phone", "invalid_phone", undefined, "Vérifiez le numéro de téléphone (exemple : 06 12 34 56 78)."],
  ["answers.address.street", "required", undefined, "Indiquez la rue."],
  ["answers.address.postal_code", "required", undefined, "Indiquez le code postal."],
  ["answers.address.city", "required", undefined, "Indiquez la ville."],
  ["answers.address.country", "required", undefined, "Indiquez le pays."],
  ["answers.address.city", "too_long", undefined, "Ce texte est trop long."],
  ["answers.custom.a", "required", "text", "Indiquez une réponse."],
  ["answers.custom.a", "required", "long_text", "Indiquez une réponse."],
  ["answers.custom.a", "too_long", "long_text", "Ce texte est trop long."],
  ["answers.custom.a", "required", "date", "Indiquez une date."],
  ["answers.custom.a", "required", "datetime", "Indiquez une date et une heure."],
  ["answers.custom.a", "invalid_date", "date", "Vérifiez la date."],
  ["answers.custom.a", "invalid_date", "datetime", "Vérifiez la date."],
  ["answers.custom.a", "required", "number", "Indiquez un nombre."],
  ["answers.custom.a", "invalid_number", "number", "Indiquez un nombre, par exemple 80 ou 12,5."],
  ["answers.custom.a", "required", "single_choice", "Choisissez une option."],
  ["answers.custom.a", "invalid_choice", "single_choice", "Choisissez l’une des options proposées."],
  ["answers.custom.a", "required", "checkbox", "Cochez cette case pour continuer."],
  ["consent", "required", undefined, "Cochez cette case pour envoyer vos coordonnées."],
];

describe("fieldMessageKey", () => {
  test.each(CASES)("FRM-046 %s %s (%s) has its own message", (path, code, kind, message) => {
    expect(text(fieldMessageKey(path, code, kind))).toBe(message);
  });

  test("FRM-046 a code without a message of its own falls back to the shared one", () => {
    expect(fieldMessageKey("answers.custom.a", "invalid_value", "text")).toBe("fieldErrors.invalid_value");
  });
});

describe("errorCount", () => {
  test("FRM-046 counts the fields in error", () => {
    expect(errorCount({})).toBe(0);
    expect(errorCount({ "answers.email": "invalid_email", consent: "required" })).toBe(2);
  });
});
