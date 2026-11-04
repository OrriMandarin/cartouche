import { describe, expect, test } from "vitest";
import { supportShellSlots } from "./shell";

const labels = { support: "Support", user: "Compte", card: "Carte", events: "Événements", contacts: "Contacts" };

describe("supportShellSlots", () => {
  test("ADM-001 the support home has a title and no way back", () => {
    expect(supportShellSlots({ kind: "home" }, labels)).toEqual({
      title: "Support",
      breadcrumb: [{ label: "Support" }],
    });
  });

  test("ADM-006 an account page goes back to the support", () => {
    expect(supportShellSlots({ kind: "user" }, labels)).toEqual({
      title: "Compte",
      breadcrumb: [{ label: "Support", href: "/support" }, { label: "Compte" }],
      back: { href: "/support", label: "Support" },
    });
  });

  test("ADM-013 a card page goes back to the support", () => {
    expect(supportShellSlots({ kind: "card" }, labels).back).toEqual({ href: "/support", label: "Support" });
  });

  test("ADM-016 the events of a card go back to the card", () => {
    expect(supportShellSlots({ kind: "events", cardId: "c1" }, labels)).toEqual({
      title: "Événements",
      breadcrumb: [
        { label: "Support", href: "/support" },
        { label: "Carte", href: "/support/cards/c1" },
        { label: "Événements" },
      ],
      back: { href: "/support/cards/c1", label: "Carte" },
    });
  });

  test("ADM-017 the contacts of a card and of an event go back to the events", () => {
    for (const kind of ["cardLeads", "eventLeads"] as const) {
      expect(supportShellSlots({ kind, cardId: "c1" }, labels)).toEqual({
        title: "Contacts",
        breadcrumb: [
          { label: "Support", href: "/support" },
          { label: "Carte", href: "/support/cards/c1" },
          { label: "Événements", href: "/support/cards/c1/events" },
          { label: "Contacts" },
        ],
        back: { href: "/support/cards/c1/events", label: "Événements" },
      });
    }
  });
});
