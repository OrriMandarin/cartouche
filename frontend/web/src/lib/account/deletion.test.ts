import { describe, expect, test } from "vitest";
import { isDeletionConfirmed } from "./deletion";

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
