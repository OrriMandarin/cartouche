import { ApiError } from "@cartouche/api-client";
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithIntl } from "@/components/editor/test-helpers";
import { eventView } from "@/lib/events/event-view.fixture";
import SupportCardEventsPage from "./page";

const get = vi.fn();
let isAdmin = true;
vi.mock("@/lib/api", () => ({ useApi: () => ({ GET: get }) }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "card-1" }) }));
vi.mock("@/components/account/AccountGate", () => ({
  AccountGate: ({ children }: { children: React.ReactNode }) => children,
  useMe: () => ({ is_admin: isAdmin }),
}));

beforeEach(() => {
  get.mockReset();
  isAdmin = true;
});

describe("SupportCardEventsPage", () => {
  test("ADM-016 lists the events of the card of the address", async () => {
    get.mockResolvedValue({ data: { events: [eventView({ id: "e1", title: "Salon ✨", lead_count: 2 })] } });
    renderWithIntl(<SupportCardEventsPage />);

    expect(await screen.findByTestId("support-event-row-e1")).toHaveTextContent("Salon ✨");
    expect(get).toHaveBeenCalledWith("/api/admin/cards/{id}/events", { params: { path: { id: "card-1" } } });
    expect(screen.getByTestId("support-back")).toHaveAttribute("href", "/support/cards/card-1");
  });

  test("ADM-001 a non-administrator sees « Accès réservé » and no admin request is made", () => {
    isAdmin = false;
    renderWithIntl(<SupportCardEventsPage />);
    expect(screen.getByTestId("support-forbidden")).toHaveTextContent("Accès réservé");
    expect(get).not.toHaveBeenCalled();
  });

  test("ADM-016 an unknown card reads as « Carte introuvable »", async () => {
    get.mockRejectedValue(new ApiError({ status: 404, code: "not_found", message: "No.", requestId: "r1" }));
    renderWithIntl(<SupportCardEventsPage />);
    await waitFor(() => expect(screen.getByTestId("support-not-found")).toHaveTextContent("Carte introuvable"));
  });
});
