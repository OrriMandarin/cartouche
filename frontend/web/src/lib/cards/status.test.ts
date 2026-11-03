import { describe, expect, test } from "vitest";
import { canDuplicate, canToggle, cardStatusLabelKey } from "./status";

describe("card status", () => {
  test("EDI-012 LNK-011 status labels and toggling", () => {
    expect(cardStatusLabelKey("active")).toBe("cards.status.active");
    expect(cardStatusLabelKey("disabled")).toBe("cards.status.disabled");
    expect(cardStatusLabelKey("disabled_by_support")).toBe("cards.status.disabledBySupport");
    expect(canToggle("active")).toBe(true);
    expect(canToggle("disabled")).toBe(true);
    expect(canToggle("disabled_by_support")).toBe(false);
    expect(canDuplicate("disabled")).toBe(true);
    expect(canDuplicate("disabled_by_support")).toBe(false);
  });
});
