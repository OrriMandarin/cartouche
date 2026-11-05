import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import messages from "../../../../messages/fr.json";
import { sampleCard } from "@/templates/fixtures";
import { INACTIVE_METADATA } from "@/lib/og";
import PublicCardPage, { generateMetadata } from "./page";

const fetchPublicCard = vi.fn();

vi.mock("@/lib/public-card", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/public-card")>()),
  fetchPublicCard: (slug: string) => fetchPublicCard(slug),
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

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) =>
    key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], messages),
}));

const props = (slug: string) => ({ params: Promise.resolve({ slug }) });

async function renderPage(slug: string) {
  const element = await PublicCardPage(props(slug));
  return render(<NextIntlClientProvider locale="fr" messages={messages}>{element}</NextIntlClientProvider>);
}

beforeEach(() => {
  fetchPublicCard.mockReset();
});

describe("public card page", () => {
  test("PUB-002 PUB-011 an active card is rendered with its template", async () => {
    fetchPublicCard.mockResolvedValue({ state: "active", card: sampleCard });
    await renderPage("eloise-daubigne");
    expect(screen.getByTestId("card-name")).toHaveTextContent("Éloïse D'Aubigné-Müller");
    expect(screen.getByTestId("save-contact")).toHaveAttribute("href", sampleCard.vcard_url);
    expect(screen.getByTestId("save-contact")).toHaveTextContent("Enregistrer le contact");
  });

  test("PUB-010 a card without a running event shows no button", async () => {
    fetchPublicCard.mockResolvedValue({ state: "active", card: sampleCard });
    await renderPage("eloise-daubigne");
    expect(screen.queryAllByTestId(/^event-button-/)).toHaveLength(0);
  });

  test("PUB-008 PUB-009 PUB-029 the running events of the card are its buttons, towards their forms", async () => {
    const events = [
      { id: "event-1", title: "Salon du Mariage ✨", starts_at: "2027-03-15T08:00:00Z" },
      { id: "event-2", title: "Portes ouvertes de l’Atelier", starts_at: "2027-03-15T09:00:00Z" },
    ];
    fetchPublicCard.mockResolvedValue({ state: "active", card: { ...sampleCard, events } });
    await renderPage("eloise-daubigne");
    const buttons = screen.getAllByTestId(/^event-button-/);
    const names = screen.getAllByTestId("card-event-name");
    expect(names.map((name) => name.textContent)).toEqual(["Salon du Mariage ✨", "Portes ouvertes de l’Atelier"]);
    expect(buttons[0]).toHaveAttribute("href", `/c/${sampleCard.slug}/e/event-1`);
  });

  test("LNK-003 LNK-024 an old slug redirects permanently to the current one", async () => {
    fetchPublicCard.mockResolvedValue({ state: "redirect", slug: "alice-durand" });
    await expect(PublicCardPage(props("alice"))).rejects.toThrow("redirect:/c/alice-durand");
  });

  test("TPL-026 PUB-037 an active card sits in the page frame that carries its theme", async () => {
    fetchPublicCard.mockResolvedValue({ state: "active", card: { ...sampleCard, theme: { preset: "craie", accent: "#c0392b" } } });
    const { container } = await renderPage("eloise-daubigne");
    const frame = container.querySelector<HTMLElement>(".cc-page");
    expect(frame?.style.getPropertyValue("--c-accent")).toBe("#c0392b");
    expect(frame?.querySelector(":scope > .cc-stage > article.cc")).not.toBeNull();
  });

  test("LNK-023 LNK-027 an unknown slug and an inactive card both end in notFound", async () => {
    fetchPublicCard.mockResolvedValue(null);
    await expect(PublicCardPage(props("personne"))).rejects.toThrow("not-found");
    fetchPublicCard.mockResolvedValue({ state: "inactive" });
    await expect(PublicCardPage(props("alice-archive"))).rejects.toThrow("not-found");
  });
});

describe("public card metadata", () => {
  test("PUB-017 an active card gets its link preview", async () => {
    fetchPublicCard.mockResolvedValue({ state: "active", card: sampleCard });
    const metadata = await generateMetadata(props("eloise-daubigne"));
    expect(metadata.openGraph).toMatchObject({ title: "Éloïse D'Aubigné-Müller", url: sampleCard.public_url });
  });

  test("LNK-027 an inactive card gets no preview and is not indexed", async () => {
    fetchPublicCard.mockResolvedValue({ state: "inactive" });
    const metadata = await generateMetadata(props("alice-archive"));
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.openGraph).toBeUndefined();
    expect(metadata.title).toBeUndefined();
  });

  test("LNK-023 LNK-027 an unknown slug gets the same neutral metadata", async () => {
    fetchPublicCard.mockResolvedValue(null);
    expect(await generateMetadata(props("personne"))).toEqual(INACTIVE_METADATA);
  });
});
