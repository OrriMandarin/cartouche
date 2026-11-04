import { ApiError } from "@cartouche/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithIntl } from "@/components/editor/test-helpers";
import { eventView } from "@/lib/events/event-view.fixture";
import type { EventView } from "@/lib/events/types";

const post = vi.fn();
const del = vi.fn();
const push = vi.fn();
vi.mock("@/lib/api", () => ({ useApi: () => ({ POST: post, DELETE: del }), useDownloadExport: () => vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { EventStatePanel } from "./EventStatePanel";

const running = eventView({
  id: "event-1",
  card_id: "card-1",
  title: "Salon du Mariage ✨",
  starts_at: "2027-03-15T08:00:00Z",
  ends_at: "2027-03-15T16:00:00Z",
  phase: "running",
  lead_count: 3,
});

function renderPanel(event: EventView = running, onEnded = vi.fn()) {
  renderWithIntl(<EventStatePanel event={event} zone="Europe/Paris" onEnded={onEnded} />);
  return onEnded;
}

beforeEach(() => {
  post.mockReset();
  del.mockReset();
  push.mockReset();
  del.mockResolvedValue({});
});

describe("EventStatePanel", () => {
  test("EDI-019 the state panel shows the phase, the dates and the contacts of the event", () => {
    renderPanel();
    expect(screen.getByTestId("event-state-phase")).toHaveTextContent("En cours");
    expect(screen.getByTestId("event-state-dates")).toHaveTextContent(
      "Depuis le 15 mars 2027 à 09:00 · se termine le 15 mars 2027 à 17:00.",
    );
    expect(screen.getByTestId("event-state-contacts")).toHaveTextContent("Voir les 3 contacts");
    expect(screen.getByTestId("event-state-contacts")).toHaveAttribute("href", "/dashboard/cards/card-1/events/event-1/leads");
  });

  test("EDI-019 the contacts link reads right for none and for one", () => {
    const { unmount } = renderWithIntl(<EventStatePanel event={{ ...running, lead_count: 0 }} zone="Europe/Paris" onEnded={vi.fn()} />);
    expect(screen.getByTestId("event-state-contacts")).toHaveTextContent("Voir les contacts");
    unmount();
    renderWithIntl(<EventStatePanel event={{ ...running, lead_count: 1 }} zone="Europe/Paris" onEnded={vi.fn()} />);
    expect(screen.getByTestId("event-state-contacts")).toHaveTextContent("Voir le contact");
  });

  test("EDI-019 EVT-006 the state panel ends a running event now, and then offers it no more", async () => {
    const ended = { ...running, phase: "past" as const, ends_at: "2027-03-15T10:00:00Z" };
    post.mockResolvedValue({ data: ended });
    const onEnded = renderPanel();
    fireEvent.click(screen.getByTestId("event-state-end-now"));
    await waitFor(() => expect(onEnded).toHaveBeenCalledWith(ended));
    expect(post).toHaveBeenCalledWith("/api/events/{id}/end", { params: { path: { id: "event-1" } } });
    expect(screen.getByTestId("event-state-phase")).toHaveTextContent("Passé");
    expect(screen.queryByTestId("event-state-end-now")).toBeNull();
  });

  test("EVT-006 only a running event can be ended", () => {
    renderPanel({ ...running, phase: "upcoming" });
    expect(screen.queryByTestId("event-state-end-now")).toBeNull();
    expect(screen.getByTestId("event-state-delete")).toBeVisible();
  });

  test("EVT-021 an event that is no longer running says so", async () => {
    post.mockRejectedValue(new ApiError({ status: 409, code: "event_not_running", message: "no", requestId: "r1" }));
    renderPanel();
    fireEvent.click(screen.getByTestId("event-state-end-now"));
    expect(await screen.findByTestId("event-state-error")).toHaveTextContent("n’est pas en cours");
    expect(screen.getByTestId("event-state-end-now")).toBeEnabled();
  });

  test("EDI-019 EDI-033 EVT-024 the state panel deletes the event after a confirmation that counts its contacts", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("event-state-delete"));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Les 3 contacts collectés pendant cet événement");
    fireEvent.click(screen.getByTestId("event-delete-cancel"));
    expect(del).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("event-state-delete"));
    fireEvent.click(screen.getByTestId("event-delete-confirm"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/cards/card-1/events"));
    expect(del).toHaveBeenCalledWith("/api/events/{id}", { params: { path: { id: "event-1" } } });
  });

  test("EDI-019 a failed deletion stays on the page and shows the notice", async () => {
    del.mockRejectedValue(new ApiError({ status: 500, code: "internal_error", message: "Boom.", requestId: "req-9" }));
    renderPanel();
    fireEvent.click(screen.getByTestId("event-state-delete"));
    fireEvent.click(screen.getByTestId("event-delete-confirm"));
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-9");
    expect(push).not.toHaveBeenCalled();
  });
});
