import { describe, expect, test } from "vitest";
import { cardDisplayName } from "./display-name";

describe("cardDisplayName", () => {
  test("EDI-012 joins first and last name", () => {
    expect(cardDisplayName({ first_name: "Éloïse", last_name: "D'Aubigné-Müller" })).toBe("Éloïse D'Aubigné-Müller");
    expect(cardDisplayName({ first_name: "Alice" })).toBe("Alice");
    expect(cardDisplayName({ last_name: "Durand", first_name: null })).toBe("Durand");
  });

  test("EDI-012 a card without a name has none", () => {
    expect(cardDisplayName({})).toBeNull();
    expect(cardDisplayName({ first_name: "", last_name: null })).toBeNull();
  });
});
