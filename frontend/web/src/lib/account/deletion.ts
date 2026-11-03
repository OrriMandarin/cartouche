/** spec: ACC-020. Whether the typed text confirms the deletion: the word, case and surrounding spaces ignored. */
export function isDeletionConfirmed(input: string, word: string): boolean {
  return input.trim().toLowerCase() === word.trim().toLowerCase();
}
