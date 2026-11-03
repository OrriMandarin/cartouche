import { ApiError } from "@cartouche/api-client";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { cardView } from "@/components/cards/card-view.fixture";
import { renderWithIntl } from "@/components/editor/test-helpers";
import { eventView } from "@/lib/events/event-view.fixture";
import EditEventPage from "./page";

const get = vi.fn();
const api = { GET: get };
vi.mock("@/lib/api", () => ({ useApi: () => api }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "card-1", eventId: "event-1" }) }));
vi.mock("@/components/account/AccountGate", () => ({ AccountGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/events/EventEditor", () => ({
  EventEditor: ({ event }: { event: { title: string } }) => <p data-testid="editor-stub">{event.title}</p>,
}));

beforeEach(() => {
  get.mockReset();
});

function answer(event: unknown) {
  get.mockImplementation((path: string) =>
    path === "/api/cards/{id}" ? Promise.resolve({ data: cardView({ id: "card-1" }) }) : event instanceof Error ? Promise.reject(event) : Promise.resolve({ data: event }),
  );
}

describe("EditEventPage", () => {
  test("EDI-019 EVT-009 opens the editor on the event of the address", async () => {
    answer(eventView({ id: "event-1", card_id: "card-1", title: "Portes ouvertes" }));
    renderWithIntl(<EditEventPage />);
    expect(await screen.findByTestId("editor-stub")).toHaveTextContent("Portes ouvertes");
    expect(get).toHaveBeenCalledWith("/api/events/{id}", { params: { path: { id: "event-1" } } });
  });

  test("ACC-017 an event that does not exist or belongs to someone else reads as « Événement introuvable »", async () => {
    answer(new ApiError({ status: 404, code: "not_found", message: "No such event.", requestId: "r1" }));
    renderWithIntl(<EditEventPage />);
    expect(await screen.findByTestId("event-not-found")).toHaveTextContent("Événement introuvable");
    expect(screen.queryByTestId("editor-stub")).toBeNull();
  });

  test("ACC-017 an event of another card is not reachable from this one", async () => {
    answer(eventView({ id: "event-1", card_id: "card-2" }));
    renderWithIntl(<EditEventPage />);
    expect(await screen.findByTestId("event-not-found")).toBeVisible();
    expect(screen.queryByTestId("editor-stub")).toBeNull();
  });

  test("EDI-019 any other failure shows the generic notice with the request id", async () => {
    answer(new ApiError({ status: 500, code: "internal_error", message: "Boom.", requestId: "req-1" }));
    renderWithIntl(<EditEventPage />);
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-1");
  });
});
