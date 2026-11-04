const VOWEL = /^[aeiouy]/;

/** The message of the vCard button on the confirmation, under `eventForm.confirmation` (FRM-047). */
export function contactLabel(cardFirstName: string): { key: string; values?: { firstName: string } } {
  const firstName = cardFirstName.trim();
  if (firstName === "") return { key: "saveContact" };
  // "d’" before a vowel, accented or not: the accents are stripped to compare the letter.
  const letter = firstName.normalize("NFD").charAt(0).toLowerCase();
  return { key: VOWEL.test(letter) ? "saveContactOfElided" : "saveContactOf", values: { firstName } };
}
