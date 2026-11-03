import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithIntl } from "@/components/editor/test-helpers";
import { eventView } from "@/lib/events/event-view.fixture";
import { leadView } from "@/lib/events/lead-view.fixture";
import SupportEventLeadsPage from "./page";

const get = vi.fn();
let isAdmin = true;
vi.mock("@/lib/api", () => ({ useApi: () => ({ GET: get }) }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "card-1", eventId: "ev-1" }) }));
vi.mock("@/components/account/AccountGate", () => ({
  AccountGate: ({ children }: { children: React.ReactNode }) => children,
  useMe: () => ({ is_admin: isAdmin }),
}));

function serve(events = [eventView({ id: "ev-1", title: "Salon du Mariage ✨" })]) {
  get.mockImplementation((path: string) =>
    Promise.resolve({
      data: path === "/api/admin/cards/{id}/events" ? { events } : { leads: [leadView({ id: "lead-1" })] },
    }),
  );
}

beforeEach(() => {
  get.mockReset();
  isAdmin = true;
});

describe("SupportEventLeadsPage", () => {
  test("ADM-017 ADM-018 reads the event's leads read-only under the notice, named after the event", async () => {
    serve();
    renderWithIntl(<SupportEventLeadsPage />);

    expect(await screen.findByTestId("lead-row-lead-1")).toBeVisible();
    expect(screen.getByTestId("support-leads-subtitle")).toHaveTextContent("Salon du Mariage ✨");
    expect(screen.getByTestId("support-leads-notice")).toBeVisible();
    expect(screen.queryByTestId("export-open")).toBeNull();
    expect(screen.queryByTestId("lead-spam-lead-1")).toBeNull();
    expect(get).toHaveBeenCalledWith("/api/admin/events/{id}/leads", { params: { path: { id: "ev-1" } } });
    // One load of the leads, hence one audit entry.
    expect(get.mock.calls.filter(([path]) => path === "/api/admin/events/{id}/leads")).toHaveLength(1);
  });

  test("ADM-016 an event that is not in the card reads as « Événement introuvable » and no lead is requested", async () => {
    serve([eventView({ id: "other" })]);
    renderWithIntl(<SupportEventLeadsPage />);
    expect(await screen.findByTestId("support-not-found")).toHaveTextContent("Événement introuvable");
    expect(get).not.toHaveBeenCalledWith("/api/admin/events/{id}/leads", expect.anything());
  });

  test("ADM-001 a non-administrator sees « Accès réservé » and no admin request is made", () => {
    isAdmin = false;
    renderWithIntl(<SupportEventLeadsPage />);
    expect(screen.getByTestId("support-forbidden")).toHaveTextContent("Accès réservé");
    expect(get).not.toHaveBeenCalled();
  });
});
