import { ApiError } from "@cartouche/api-client";

/** spec: ACC-020. Whether the typed text confirms the deletion: the word, case and surrounding spaces ignored. */
export function isDeletionConfirmed(input: string, word: string): boolean {
  return input.trim().toLowerCase() === word.trim().toLowerCase();
}

/** What the answer to `DELETE /api/me` means for the page (ACC-021, ACC-022, ACC-023). */
export type DeletionOutcome =
  /** The account is gone: leave for the deleted page. */
  | { kind: "deleted" }
  /** The account is an administrator's: it cannot be deleted (ACC-021). */
  | { kind: "admin" }
  /** Anything else: show the error and allow trying again (ACC-022). */
  | { kind: "failed"; error: unknown };

/** Reads the error thrown by the deletion request, `null` when it succeeded. */
export function deletionOutcome(error: unknown): DeletionOutcome {
  if (error === null) return { kind: "deleted" };
  if (error instanceof ApiError) {
    // 404: the account was deleted elsewhere in the meantime (another tab), which is what was asked for.
    if (error.status === 404) return { kind: "deleted" };
    if (error.code === "cannot_delete_admin") return { kind: "admin" };
  }
  return { kind: "failed", error };
}
