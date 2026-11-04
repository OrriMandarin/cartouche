import { ApiError } from "@cartouche/api-client";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { cardView } from "@/components/cards/card-view.fixture";
import { renderWithIntl } from "@/components/editor/test-helpers";
import { eventView } from "@/lib/events/event-view.fixture";
import { userTimeZone, zoneLabel } from "@/lib/events/time";
import CardEventsPage from "./page";

const get = vi.fn();
const api = { GET: get };
vi.mock("@/lib/api", () => ({ useApi: () => api }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "card-1" }) }));
vi.mock("@/components/account/AccountGate", () => ({
  AccountGate: ({ children }: { children: React.ReactNode }) => children,
  useMe: () => ({ max_simultaneous_events: 3 }),
}));
vi.mock("@/components/events/EventList", () => ({
  EventList: ({ events, max }: { events: { title: string }[]; max: number }) => (
    <p data-testid="list-stub">{events.map((e) => e.title).join("|")}{`#${max}`}</p>
  ),
}));

beforeEach(() => {
  get.mockReset();
});

describe("CardEventsPage", () => {
  test("EDI-009 EDI-018 loads the card and its events by the id of the address", async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve({
        data:
          path === "/api/cards/{id}"
            ? cardView({ id: "card-1", content: { first_name: "Alice", last_name: "Durand" } })
            : { events: [eventView({ title: "Salon ✨" }), eventView({ id: "e2", title: "Foire" })] },
      }),
    );
    renderWithIntl(<CardEventsPage />);
    expect(screen.getByTestId("events-loading")).toBeVisible();
    expect(await screen.findByTestId("list-stub")).toHaveTextContent("Salon ✨|Foire#3");
    // EVT-022: the times follow the browser's zone, which is the only one the sub-header names.
    expect(screen.getByTestId("events-card-name")).toHaveTextContent(
      `Carte alice-durand · fuseau : ${zoneLabel(userTimeZone())}`,
    );
    expect(screen.getByTestId("events-card-name")).not.toHaveTextContent("Paris (");
    expect(screen.getByTestId("new-event")).toHaveAttribute("href", "/dashboard/cards/card-1/events/new");
    expect(get).toHaveBeenCalledWith("/api/cards/{id}/events", { params: { path: { id: "card-1" } } });
  });

  test("EDI-010 LEA-013 the card's events page links to the whole-card view, even with no event", async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve({ data: path === "/api/cards/{id}" ? cardView({ id: "card-1" }) : { events: [] } }),
    );
    renderWithIntl(<CardEventsPage />);
    const link = await screen.findByTestId("card-leads-link");
    expect(link).toHaveAttribute("href", "/dashboard/cards/card-1/leads");
    expect(link).toHaveTextContent("Tous les contacts de la carte");
  });

  test("EVT-025 LNK-008 the events of a disabled card are listed all the same", async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve({ data: path === "/api/cards/{id}" ? cardView({ status: "disabled" }) : { events: [eventView({ title: "Archivé" })] } }),
    );
    renderWithIntl(<CardEventsPage />);
    expect(await screen.findByTestId("list-stub")).toHaveTextContent("Archivé");
  });

  test("ACC-017 the card of someone else or a missing one reads as « Carte introuvable »", async () => {
    get.mockRejectedValue(new ApiError({ status: 404, code: "not_found", message: "No such card.", requestId: "r1" }));
    renderWithIntl(<CardEventsPage />);
    expect(await screen.findByTestId("card-not-found")).toHaveTextContent("Carte introuvable");
    expect(screen.queryByTestId("list-stub")).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });

  test("EDI-009 a failure to list the events shows the generic notice with the request id", async () => {
    get.mockImplementation((path: string) =>
      path === "/api/cards/{id}"
        ? Promise.resolve({ data: cardView() })
        : Promise.reject(new ApiError({ status: 500, code: "internal_error", message: "Boom.", requestId: "req-1" })),
    );
    renderWithIntl(<CardEventsPage />);
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-1");
    expect(screen.queryByTestId("list-stub")).toBeNull();
  });
});
