import { describe, expect, test } from "vitest";
import { sampleCard } from "@/templates/fixtures";
import { buildCardUrls, toPublicEvents } from "./public-card";

describe("buildCardUrls", () => {
  test("PUB-014 the vCard url is the one the API gave", () => {
    expect(buildCardUrls(sampleCard).vcard).toBe(sampleCard.vcard_url);
  });

  test("PUB-008 the event form lives under the card page", () => {
    expect(buildCardUrls(sampleCard).eventForm("evt-salon")).toBe("/c/eloise-daubigne/e/evt-salon");
  });

  test("PUB-008 the slug and the event id are percent-encoded in the path", () => {
    const urls = buildCardUrls({ ...sampleCard, slug: "a/b?c" });
    expect(urls.eventForm("x/../y?z#w")).toBe("/c/a%2Fb%3Fc/e/x%2F..%2Fy%3Fz%23w");
  });
});

describe("toPublicEvents", () => {
  test("PUB-008 PUB-029 public events come from the card, in the order the API gave", () => {
    const card = {
      ...sampleCard,
      events: [
        { id: "evt-a", title: "Atelier d’écriture ✨", starts_at: "2026-11-05T09:00:00Z" },
        { id: "evt-b", title: "Salon", starts_at: "2026-11-05T09:00:00Z" },
        { id: "evt-c", title: "Brunch", starts_at: "2026-11-06T09:00:00Z" },
      ],
    };
    expect(toPublicEvents(card)).toEqual([
      { id: "evt-a", title: "Atelier d’écriture ✨", startsAt: "2026-11-05T09:00:00Z" },
      { id: "evt-b", title: "Salon", startsAt: "2026-11-05T09:00:00Z" },
      { id: "evt-c", title: "Brunch", startsAt: "2026-11-06T09:00:00Z" },
    ]);
  });

  test("PUB-008 a card without running event gives none", () => {
    expect(toPublicEvents({ ...sampleCard, events: [] })).toEqual([]);
  });
});
