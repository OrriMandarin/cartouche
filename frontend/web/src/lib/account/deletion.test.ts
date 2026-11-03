import { ApiError } from "@cartouche/api-client";
import { describe, expect, test } from "vitest";
import { deletionOutcome, isDeletionConfirmed } from "./deletion";

describe("isDeletionConfirmed", () => {
  test("ACC-020 the confirmation word ignores case and spaces", () => {
    expect(isDeletionConfirmed("SUPPRIMER", "SUPPRIMER")).toBe(true);
    expect(isDeletionConfirmed("  supprimer ", "SUPPRIMER")).toBe(true);
    expect(isDeletionConfirmed("Supprimer\n", "SUPPRIMER")).toBe(true);
  });

  test("ACC-020 anything else keeps the deletion locked", () => {
    expect(isDeletionConfirmed("", "SUPPRIMER")).toBe(false);
    expect(isDeletionConfirmed("supprime", "SUPPRIMER")).toBe(false);
    expect(isDeletionConfirmed("supp rimer", "SUPPRIMER")).toBe(false);
  });
});

function refusal(status: number, code: string): ApiError {
  return new ApiError({ status, code, message: code, requestId: "req-1" });
}

describe("deletionOutcome", () => {
  test("ACC-023 a successful deletion is deleted", () => {
    expect(deletionOutcome(null)).toEqual({ kind: "deleted" });
  });

  test("ACC-023 an account already gone (deleted elsewhere at the same time) counts as deleted", () => {
    expect(deletionOutcome(refusal(404, "not_found"))).toEqual({ kind: "deleted" });
  });

  test("ACC-021 a refusal for an administrator is its own outcome", () => {
    expect(deletionOutcome(refusal(403, "cannot_delete_admin"))).toEqual({ kind: "admin" });
  });

  test("ACC-022 any other failure is an error to show, with the original error", () => {
    const failure = refusal(500, "internal_error");
    expect(deletionOutcome(failure)).toEqual({ kind: "failed", error: failure });
    const network = new TypeError("Failed to fetch");
    expect(deletionOutcome(network)).toEqual({ kind: "failed", error: network });
  });
});
