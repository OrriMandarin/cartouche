import { describe, expect, test } from "vitest";
import { canDuplicate, canToggle, cardStatusLabelKey, countActive } from "./status";

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

describe("countActive", () => {
  test("EDI-023 counts only the active cards", () => {
    expect(countActive([{ status: "active" }, { status: "disabled" }, { status: "disabled_by_support" }, { status: "active" }])).toBe(2);
    expect(countActive([])).toBe(0);
  });
});
