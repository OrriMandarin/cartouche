import { describe, expect, test } from "vitest";
import { cardView } from "@/components/cards/card-view.fixture";
import { contactsHref, leadsInScope, scopeTabs, selectedCard, selectedEventId } from "./contacts-scope";
import { eventView } from "./event-view.fixture";
import { leadView } from "./lead-view.fixture";

const first = cardView({ id: "card-1", slug: "alice-durand" });
const second = cardView({ id: "card-2", slug: "alice-pro" });
const recent = eventView({ id: "ev-recent", title: "Salon 2027", starts_at: "2027-02-06T09:00:00Z" });
const old = eventView({ id: "ev-old", title: "Salon 2026", starts_at: "2026-02-07T09:00:00Z" });
const empty = eventView({ id: "ev-empty", title: "Nuit des prestataires", starts_at: "2025-11-14T18:00:00Z" });
const leads = [
  leadView({ id: "l1", event_id: "ev-recent" }),
  leadView({ id: "l2", event_id: "ev-recent", spam: true }),
  leadView({ id: "l3", event_id: "ev-old" }),
];

describe("contacts scope", () => {
  test("EDI-031 the card is the one asked for in the address, else the first", () => {
    expect(selectedCard([first, second], "card-2")).toBe(second);
    expect(selectedCard([first, second], null)).toBe(first);
    expect(selectedCard([first, second], "nobody")).toBe(first);
    expect(selectedCard([], null)).toBeNull();
  });

  test("EDI-031 the scope is the event asked for when the card has it, else the whole card", () => {
    expect(selectedEventId([recent, old], "ev-old")).toBe("ev-old");
    expect(selectedEventId([recent, old], "elsewhere")).toBeNull();
    expect(selectedEventId([recent, old], null)).toBeNull();
  });

  test("EDI-031 the leads of a scope: all of them, or those of one event", () => {
    expect(leadsInScope(leads, null).map((lead) => lead.id)).toEqual(["l1", "l2", "l3"]);
    expect(leadsInScope(leads, "ev-recent").map((lead) => lead.id)).toEqual(["l1", "l2"]);
    expect(leadsInScope(leads, "ev-empty")).toEqual([]);
  });

  test("EDI-031 the tabs: the whole card first, then each event, newest first, with the contacts it holds", () => {
    expect(scopeTabs([empty, old, recent], leads)).toEqual([
      { eventId: null, title: null, count: 3 },
      { eventId: "ev-recent", title: "Salon 2027", count: 2 },
      { eventId: "ev-old", title: "Salon 2026", count: 1 },
      { eventId: "ev-empty", title: "Nuit des prestataires", count: 0 },
    ]);
  });

  test("EDI-031 the address keeps the card and the event", () => {
    expect(contactsHref("card-1", null)).toBe("/dashboard/contacts?card=card-1");
    expect(contactsHref("card-1", "ev-1")).toBe("/dashboard/contacts?card=card-1&event=ev-1");
  });
});
