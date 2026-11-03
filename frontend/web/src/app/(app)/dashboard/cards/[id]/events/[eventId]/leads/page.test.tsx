import { ApiError } from "@cartouche/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { cardView } from "@/components/cards/card-view.fixture";
import { renderWithIntl } from "@/components/editor/test-helpers";
import { eventView } from "@/lib/events/event-view.fixture";
import type { LeadActions } from "@/lib/events/lead-actions";
import { leadView } from "@/lib/events/lead-view.fixture";
import type { LeadView } from "@/lib/events/types";
import EventLeadsPage from "./page";

const get = vi.fn();
const put = vi.fn();
const del = vi.fn();
const api = { GET: get, PUT: put, DELETE: del };
vi.mock("@/lib/api", () => ({ useApi: () => api }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "card-1", eventId: "event-1" }) }));
vi.mock("@/components/account/AccountGate", () => ({ AccountGate: ({ children }: { children: React.ReactNode }) => children }));
const lead = leadView({ id: "lead-1" });
vi.mock("@/components/events/LeadList", () => ({
  LeadList: ({ load, actions, showEvent }: { load: () => Promise<LeadView[]>; actions: LeadActions | null; showEvent: boolean }) => (
    <div data-testid="lead-list-stub" data-show-event={String(showEvent)}>
      <button data-testid="stub-load" onClick={() => void load()} />
      <button data-testid="stub-spam" onClick={() => void actions?.setSpam(lead, true)} />
      <button data-testid="stub-remove" onClick={() => void actions?.remove(lead)} />
    </div>
  ),
}));

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  del.mockReset();
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
    expect(await screen.findByTestId("lead-list-stub")).toBeVisible();
    expect(screen.getByTestId("leads-event-title")).toHaveTextContent("Salon du Mariage ✨");
    expect(screen.getByTestId("leads-back")).toHaveAttribute("href", "/dashboard/cards/card-1/events");
    expect(get).toHaveBeenCalledWith("/api/events/{id}", { params: { path: { id: "event-1" } } });
  });

  test("EDI-020 LEA-014 the list loads the leads of the event, with the owner's actions and without the event title", async () => {
    answer(eventView({ id: "event-1", card_id: "card-1" }));
    renderWithIntl(<EventLeadsPage />);
    const list = await screen.findByTestId("lead-list-stub");
    expect(list).toHaveAttribute("data-show-event", "false");

    get.mockImplementation(() => Promise.resolve({ data: { leads: [lead] } }));
    fireEvent.click(screen.getByTestId("stub-load"));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith("/api/events/{id}/leads", { params: { path: { id: "event-1" } } }));

    put.mockResolvedValue({ data: { ...lead, spam: true } });
    fireEvent.click(screen.getByTestId("stub-spam"));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/api/leads/{id}/spam", { params: { path: { id: "lead-1" } }, body: { spam: true } }),
    );
    del.mockResolvedValue({});
    fireEvent.click(screen.getByTestId("stub-remove"));
    await waitFor(() => expect(del).toHaveBeenCalledWith("/api/leads/{id}", { params: { path: { id: "lead-1" } } }));
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
