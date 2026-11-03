import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import messages from "../../../../../../messages/fr.json";
import { publicEventForm } from "@/lib/event-form/form.fixture";
import { sampleCard } from "@/templates/fixtures";
import EventFormRoute, { metadata } from "./page";

const fetchPublicCard = vi.fn();
const fetchPublicEvent = vi.fn();

vi.mock("@/lib/public-card", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/public-card")>()),
  fetchPublicCard: (slug: string) => fetchPublicCard(slug),
}));
vi.mock("@/lib/public-event", () => ({
  fetchPublicEvent: (slug: string, eventId: string) => fetchPublicEvent(slug, eventId),
}));

// The redirect and the 404 are thrown by Next; here they are told apart by their message.
vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error("not-found");
  },
}));

const EVENT_ID = "0198d000-0000-7000-8000-000000000001";
const card = { ...sampleCard, theme: { preset: "clair", accent: "#c0392b" } };
const props = (slug = card.slug, eventId = EVENT_ID) => ({ params: Promise.resolve({ slug, eventId }) });

async function html(slug?: string, eventId?: string): Promise<string> {
  const element = await EventFormRoute(props(slug, eventId));
  return renderToString(
    <NextIntlClientProvider locale="fr" messages={messages}>
      {element}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  fetchPublicCard.mockReset();
  fetchPublicEvent.mockReset();
  fetchPublicCard.mockResolvedValue({ state: "active", card });
});

describe("event form page", () => {
  test("FRM-024 PUB-002 the form page renders on the server", async () => {
    fetchPublicEvent.mockResolvedValue({ state: "open", event: publicEventForm() });
    const page = await html();
    expect(fetchPublicEvent).toHaveBeenCalledWith(card.slug, EVENT_ID);
    expect(page).toContain('data-testid="event-form"');
    expect(page).toContain("Salon de l’Artisanat ✨");
    expect(page).toContain('data-testid="field-answers.email"');
    expect(page).toContain("J’accepte d’être recontacté·e.");
  });

  test("TPL-020 FRM-025 the form carries the card theme", async () => {
    fetchPublicEvent.mockResolvedValue({ state: "open", event: publicEventForm() });
    expect(await html()).toMatch(/data-testid="event-form-page"[^>]*style="[^"]*--card-accent:#c0392b/);
  });

  test("FRM-002 EVT-027 an event with a code renders its title and the code screen only", async () => {
    fetchPublicEvent.mockResolvedValue({ state: "code_required", event: { id: EVENT_ID, title: "Portes ouvertes" } });
    const page = await html();
    expect(page).toContain("Portes ouvertes");
    expect(page).toContain('data-testid="access-code-input"');
    expect(page).not.toContain('data-testid="event-form"');
  });

  test("FRM-024 EVT-026 outside its window the form says it is not open, with the way back", async () => {
    fetchPublicEvent.mockResolvedValue({ state: "closed", event: { id: EVENT_ID, title: "Foire de Lyon" } });
    const page = await html();
    expect(page).toContain("Ce formulaire n&#x27;est pas ouvert en ce moment.");
    expect(page).toContain(`href="/c/${card.slug}"`);
    expect(page).not.toContain('data-testid="event-form"');
  });

  test("FRM-024 an unknown event, or a card never attributed, is a 404", async () => {
    fetchPublicEvent.mockResolvedValue(null);
    await expect(EventFormRoute(props())).rejects.toThrow("not-found");
    fetchPublicCard.mockResolvedValue(null);
    await expect(EventFormRoute(props("personne"))).rejects.toThrow("not-found");
  });

  test("FRM-024 LNK-024 LNK-021 an old or uppercase slug redirects to the current form address", async () => {
    fetchPublicCard.mockResolvedValue({ state: "redirect", slug: "alice-durand" });
    await expect(EventFormRoute(props("Alice"))).rejects.toThrow(`redirect:/c/alice-durand/e/${EVENT_ID}`);
  });

  test("LNK-007 LNK-027 the form of an unserved card is the neutral page", async () => {
    fetchPublicCard.mockResolvedValue({ state: "inactive" });
    expect(await html()).toContain("Cette carte n&#x27;est plus active");
    fetchPublicCard.mockResolvedValue({ state: "active", card });
    fetchPublicEvent.mockResolvedValue({ state: "inactive" });
    const page = await html();
    expect(page).toContain("Cette carte n&#x27;est plus active");
    expect(page).not.toContain(card.content.first_name ?? "");
  });

  test("FRM-024 the form is not indexed", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
