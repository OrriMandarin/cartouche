import { ApiError } from "@cartouche/api-client";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { cardView } from "@/components/cards/card-view.fixture";
import { renderWithIntl } from "@/components/editor/test-helpers";
import { eventView } from "@/lib/events/event-view.fixture";
import EventLeadsPage from "./page";

const get = vi.fn();
const api = { GET: get };
vi.mock("@/lib/api", () => ({ useApi: () => api }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "card-1", eventId: "event-1" }) }));
vi.mock("@/components/account/AccountGate", () => ({ AccountGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/events/LeadList", () => ({
  LeadList: ({ eventId }: { eventId: string }) => <p data-testid="lead-list-stub">{eventId}</p>,
}));

beforeEach(() => {
  get.mockReset();
});

function answer(event: unknown) {
  get.mockImplementation((path: string) =>
    path === "/api/cards/{id}" ? Promise.resolve({ data: cardView({ id: "card-1" }) }) : event instanceof Error ? Promise.reject(event) : Promise.resolve({ data: event }),
  );
}

describe("EventLeadsPage", () => {
  test("EDI-020 shows the event title, a way back to the events and its contacts", async () => {
    answer(eventView({ id: "event-1", card_id: "card-1", title: "Salon du Mariage ✨" }));
    renderWithIntl(<EventLeadsPage />);
    expect(await screen.findByTestId("lead-list-stub")).toHaveTextContent("event-1");
    expect(screen.getByTestId("leads-event-title")).toHaveTextContent("Salon du Mariage ✨");
    expect(screen.getByTestId("leads-back")).toHaveAttribute("href", "/dashboard/cards/card-1/events");
    expect(get).toHaveBeenCalledWith("/api/events/{id}", { params: { path: { id: "event-1" } } });
  });

  test("ACC-017 an event that does not exist or belongs to someone else reads as « Événement introuvable »", async () => {
    answer(new ApiError({ status: 404, code: "not_found", message: "No such event.", requestId: "r1" }));
    renderWithIntl(<EventLeadsPage />);
    expect(await screen.findByTestId("event-not-found")).toHaveTextContent("Événement introuvable");
    expect(screen.queryByTestId("lead-list-stub")).toBeNull();
  });

  test("ACC-017 an event of another card is not reachable from this one", async () => {
    answer(eventView({ id: "event-1", card_id: "card-2" }));
    renderWithIntl(<EventLeadsPage />);
    expect(await screen.findByTestId("event-not-found")).toBeVisible();
    expect(screen.queryByTestId("lead-list-stub")).toBeNull();
  });
});
