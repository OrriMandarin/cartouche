import { beforeEach, describe, expect, test, vi } from "vitest";
import { sampleCard } from "@/templates/fixtures";
import EventFormLayout from "./layout";

const fetchPublicCard = vi.fn();
const fetchPublicEvent = vi.fn();

vi.mock("@/lib/public-card", () => ({
  fetchPublicCard: (slug: string) => fetchPublicCard(slug),
}));
vi.mock("@/lib/public-event", () => ({
  fetchPublicEvent: (slug: string, eventId: string) => fetchPublicEvent(slug, eventId),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));

const EVENT_ID = "0198d000-0000-7000-8000-000000000001";
const children = <p>formulaire</p>;
const layout = (slug = sampleCard.slug) =>
  EventFormLayout({ children, params: Promise.resolve({ slug, eventId: EVENT_ID }) });

beforeEach(() => {
  fetchPublicCard.mockReset();
  fetchPublicEvent.mockReset();
});

describe("event form layout", () => {
  test("LNK-007 FRM-024 an unserved or unknown card gives the neutral page", async () => {
    fetchPublicCard.mockResolvedValue({ state: "inactive" });
    await expect(layout("alice-archive")).rejects.toThrow("not-found");
    fetchPublicCard.mockResolvedValue(null);
    await expect(layout("personne")).rejects.toThrow("not-found");
    expect(fetchPublicEvent).not.toHaveBeenCalled();
  });

  test("LNK-007 FRM-024 a card disabled while its form is open gives the neutral page", async () => {
    fetchPublicCard.mockResolvedValue({ state: "active", card: sampleCard });
    fetchPublicEvent.mockResolvedValue({ state: "inactive" });
    await expect(layout()).rejects.toThrow("not-found");
    expect(fetchPublicEvent).toHaveBeenCalledWith(sampleCard.slug, EVENT_ID);
  });

  test("FRM-024 LNK-024 a served card, an old slug or an unknown event is left to the page", async () => {
    fetchPublicCard.mockResolvedValue({ state: "active", card: sampleCard });
    fetchPublicEvent.mockResolvedValue(null);
    expect(await layout()).toBe(children);
    fetchPublicCard.mockResolvedValue({ state: "redirect", slug: "alice-durand" });
    expect(await layout("alice")).toBe(children);
  });
});
