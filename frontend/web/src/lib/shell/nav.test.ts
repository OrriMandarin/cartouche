import { describe, expect, test } from "vitest";
import { currentNavKey, navEntries } from "./nav";

describe("navEntries", () => {
  test("ADM-001 the Support entry comes after Mon compte and only for administrators", () => {
    expect(navEntries(false).map((entry) => entry.key)).toEqual(["cards", "contacts", "account"]);
    expect(navEntries(true).map((entry) => [entry.key, entry.href])).toEqual([
      ["cards", "/dashboard"],
      ["contacts", "/dashboard/contacts"],
      ["account", "/dashboard/account"],
      ["support", "/support"],
    ]);
  });
});

describe("currentNavKey", () => {
  test("ADM-001 every support page belongs to Support", () => {
    for (const path of ["/support", "/support/users/u1", "/support/cards/c1/events/e1/leads"]) {
      expect(currentNavKey(path)).toBe("support");
    }
  });

  test("EDI-022 the dashboard pages keep their entry", () => {
    expect(currentNavKey("/dashboard/account")).toBe("account");
    expect(currentNavKey("/dashboard/cards/c1/events")).toBe("cards");
    expect(currentNavKey("/supporting")).toBeNull();
  });
});
