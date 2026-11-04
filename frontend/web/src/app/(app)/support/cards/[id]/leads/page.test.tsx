import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithIntl } from "@/components/editor/test-helpers";
import { leadView } from "@/lib/events/lead-view.fixture";
import SupportCardLeadsPage from "./page";

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

describe("SupportCardLeadsPage", () => {
  test("ADM-017 ADM-018 LEA-013 reads the whole card read-only, with the event of each lead", async () => {
    get.mockResolvedValue({ data: { leads: [leadView({ id: "lead-1", event_title: "Foire de Lyon" })] } });
    renderWithIntl(<SupportCardLeadsPage />);

    expect(await screen.findByTestId("lead-event-lead-1")).toHaveTextContent("Foire de Lyon");
    expect(screen.getByTestId("support-leads-notice")).toBeVisible();
    expect(screen.queryByTestId("export-open")).toBeNull();
    expect(screen.queryByTestId("lead-delete-lead-1")).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/api/admin/cards/{id}/leads", { params: { path: { id: "card-1" } } });
  });

  test("ADM-001 a non-administrator sees « Accès réservé » and no admin request is made", () => {
    isAdmin = false;
    renderWithIntl(<SupportCardLeadsPage />);
    expect(screen.getByTestId("support-forbidden")).toHaveTextContent("Accès réservé");
    expect(get).not.toHaveBeenCalled();
  });
});
