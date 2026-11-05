import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { cardView } from "@/components/cards/card-view.fixture";
import { renderWithIntl } from "@/components/editor/test-helpers";
import { eventView } from "@/lib/events/event-view.fixture";
import { leadView } from "@/lib/events/lead-view.fixture";
import type { EventView, LeadView } from "@/lib/events/types";

const get = vi.fn();
const api = { GET: get, PUT: vi.fn(), DELETE: vi.fn() };
vi.mock("@/lib/api", () => ({ useApi: () => api, useDownloadExport: () => vi.fn() }));
vi.mock("@/lib/toast", () => ({ showToast: vi.fn() }));
vi.mock("@/lib/events/time", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/time")>()),
  userTimeZone: () => "Europe/Paris",
}));
vi.mock("@/components/account/AccountGate", () => ({ AccountGate: ({ children }: { children: React.ReactNode }) => children }));
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => search }));

import ContactsPage from "./page";

const alice = cardView({ id: "card-1", slug: "alice-durand" });
const pro = cardView({ id: "card-2", slug: "alice-pro" });
const mariage = eventView({ id: "ev-mariage", card_id: "card-1", title: "Salon du Mariage 2027", starts_at: "2027-02-06T09:00:00Z" });
const paris = eventView({ id: "ev-paris", card_id: "card-1", title: "Salon de Paris 2026", starts_at: "2026-02-07T09:00:00Z" });
const bot = leadView({
  id: "lead-bot",
  event_id: "ev-mariage",
  spam: true,
  answers: { first_name: "Bot", last_name: "Spam", email: "bot@example.test" },
  phone_display: null,
});
const zoe = leadView({ id: "lead-zoe", event_id: "ev-mariage", answers: { first_name: "Zoé", last_name: "Lefèvre ✨" }, phone_display: null });
const nathan = leadView({ id: "lead-nathan", event_id: "ev-paris", event_title: "Salon de Paris 2026", answers: { first_name: "Nathan", last_name: "Bonnet" }, phone_display: null });

function serve({ cards = [alice, pro], events = [mariage, paris], leads = [bot, zoe, nathan] }: { cards?: unknown[]; events?: EventView[]; leads?: LeadView[] } = {}) {
  get.mockImplementation((path: string) => {
    if (path === "/api/cards") return Promise.resolve({ data: { cards } });
    if (path === "/api/cards/{id}/events") return Promise.resolve({ data: { events } });
    if (path === "/api/cards/{id}/leads") return Promise.resolve({ data: { leads } });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

beforeEach(() => {
  get.mockReset();
  search = new URLSearchParams();
});

describe("ContactsPage", () => {
  test("EDI-031 the contacts page picks the first card and switches scope", async () => {
    serve();
    renderWithIntl(<ContactsPage />);

    expect(await screen.findByTestId("lead-row-lead-zoe")).toBeVisible();
    expect(screen.getByTestId("contacts-card-select")).toHaveTextContent("Carte : alice-durand");
    expect(get).toHaveBeenCalledWith("/api/cards/{id}/leads", { params: { path: { id: "card-1" } } });
    expect(get).toHaveBeenCalledWith("/api/cards/{id}/events", { params: { path: { id: "card-1" } } });
    // The whole card, every contact of every event, with the event of each.
    expect(screen.getAllByTestId(/^lead-row-/)).toHaveLength(3);
    expect(screen.getByTestId("lead-event-lead-nathan")).toHaveTextContent("Salon de Paris 2026");
    expect(screen.getByTestId("leads-count")).toHaveTextContent("3 contacts, dont 1 marqué comme spam");

    // The scope tabs: the whole card, then the events from the latest, each with its count; the address carries the choice.
    expect(screen.getByTestId("contacts-scope-tab-all")).toHaveTextContent("Toute la carte 3");
    expect(screen.getByTestId("contacts-scope-tab-all")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("contacts-scope-tab-ev-mariage")).toHaveTextContent("Salon du Mariage 2027 2");
    expect(screen.getByTestId("contacts-scope-tab-ev-mariage")).toHaveAttribute("href", "/dashboard/contacts?card=card-1&event=ev-mariage");
    expect(screen.getByTestId("contacts-scope-tab-ev-paris")).toHaveTextContent("Salon de Paris 2026 1");
  });

  test("EDI-031 the event in the address narrows the list to that event", async () => {
    search = new URLSearchParams("event=ev-paris");
    serve();
    renderWithIntl(<ContactsPage />);

    await screen.findByTestId("lead-row-lead-nathan");
    expect(screen.getAllByTestId(/^lead-row-/)).toHaveLength(1);
    expect(screen.getByTestId("leads-count")).toHaveTextContent("1 contact");
    expect(screen.getByTestId("contacts-scope-tab-ev-paris")).toHaveAttribute("aria-current", "true");
    // The event is the scope: its title is not repeated on each row.
    expect(screen.queryByTestId("lead-event-lead-nathan")).toBeNull();
  });

  test("EDI-031 the card in the address is the one listed", async () => {
    search = new URLSearchParams("card=card-2");
    serve({ events: [], leads: [] });
    renderWithIntl(<ContactsPage />);

    await screen.findByTestId("leads-empty");
    expect(screen.getByTestId("contacts-card-select")).toHaveTextContent("Carte : alice-pro");
    expect(get).toHaveBeenCalledWith("/api/cards/{id}/leads", { params: { path: { id: "card-2" } } });
  });

  test("LEA-001 a card without contact says so and leads to its events", async () => {
    serve({ leads: [] });
    renderWithIntl(<ContactsPage />);

    expect(await screen.findByTestId("leads-empty")).toHaveTextContent("Aucun contact pour l’instant");
    expect(screen.getByTestId("leads-empty")).toHaveTextContent("Ils apparaîtront ici dès qu’une personne remplira le formulaire d’un de tes événements.");
    expect(screen.getByTestId("contacts-events-link")).toHaveAttribute("href", "/dashboard/cards/card-1/events");
    expect(screen.queryByTestId("leads-search")).toBeNull();
  });

  test("EDI-031 without any card there is nothing to list", async () => {
    serve({ cards: [] });
    renderWithIntl(<ContactsPage />);
    expect(await screen.findByTestId("contacts-no-cards")).toHaveTextContent("Aucune carte pour l’instant.");
  });

  test("LEA-035 the export button gives the exact count of the scope, spam left out", async () => {
    serve();
    renderWithIntl(<ContactsPage />);
    await screen.findByTestId("lead-row-lead-zoe");

    fireEvent.click(screen.getByTestId("export-open"));
    expect(await screen.findByTestId("export-scope")).toHaveTextContent("Carte alice-durand · Toute la carte · 3 contacts");
    expect(screen.getByTestId("export-download")).toHaveTextContent("Exporter 2 contacts");
    fireEvent.click(screen.getByTestId("export-include-spam"));
    expect(screen.getByTestId("export-download")).toHaveTextContent("Exporter 3 contacts");
  });

  test("LEA-035 the export of an event counts only that event", async () => {
    search = new URLSearchParams("event=ev-mariage");
    serve();
    renderWithIntl(<ContactsPage />);
    await screen.findByTestId("lead-row-lead-zoe");

    fireEvent.click(screen.getByTestId("export-open"));
    expect(await screen.findByTestId("export-scope")).toHaveTextContent("Carte alice-durand · Salon du Mariage 2027 · 2 contacts");
    await waitFor(() => expect(screen.getByTestId("export-download")).toHaveTextContent("Exporter 1 contact"));
  });
});
