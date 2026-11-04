import { ApiError } from "@cartouche/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { cardView } from "@/components/cards/card-view.fixture";
import { renderWithIntl } from "@/components/editor/test-helpers";
import type { LeadActions } from "@/lib/events/lead-actions";
import { leadView } from "@/lib/events/lead-view.fixture";
import type { LeadView } from "@/lib/events/types";
import CardLeadsPage from "./page";

const get = vi.fn();
const put = vi.fn();
const del = vi.fn();
const api = { GET: get, PUT: put, DELETE: del };
vi.mock("@/lib/api", () => ({ useApi: () => api }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "card-1" }) }));
vi.mock("@/components/account/AccountGate", () => ({ AccountGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/events/ExportDialog", () => ({
  ExportDialog: ({ scope }: { scope: { kind: string; id: string } }) => <p data-testid="export-stub">{`${scope.kind}:${scope.id}`}</p>,
}));
const lead = leadView({ id: "lead-1" });
vi.mock("@/components/events/LeadList", () => ({
  LeadList: ({
    load,
    actions,
    showEvent,
    toolbar,
  }: {
    load: () => Promise<LeadView[]>;
    actions: LeadActions | null;
    showEvent: boolean;
    toolbar?: React.ReactNode;
  }) => (
    <div data-testid="lead-list-stub" data-show-event={String(showEvent)}>
      {toolbar}
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

describe("CardLeadsPage", () => {
  test("LEA-013 the header names the card and links back to its events", async () => {
    get.mockResolvedValue({ data: cardView({ id: "card-1", content: { first_name: "Alice", last_name: "Durand" } }) });
    renderWithIntl(<CardLeadsPage />);
    expect(await screen.findByTestId("lead-list-stub")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Contacts — toute la carte");
    expect(screen.getByTestId("leads-card-name")).toHaveTextContent("Alice Durand");
    expect(screen.getByTestId("leads-back")).toHaveAttribute("href", "/dashboard/cards/card-1/events");
    expect(get).toHaveBeenCalledWith("/api/cards/{id}", { params: { path: { id: "card-1" } } });
  });

  test("LEA-013 LEA-014 the list loads every lead of the card, with the owner's actions and the title of each event", async () => {
    get.mockResolvedValue({ data: cardView({ id: "card-1" }) });
    renderWithIntl(<CardLeadsPage />);
    const list = await screen.findByTestId("lead-list-stub");
    expect(list).toHaveAttribute("data-show-event", "true");

    get.mockImplementation(() => Promise.resolve({ data: { leads: [lead] } }));
    fireEvent.click(screen.getByTestId("stub-load"));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith("/api/cards/{id}/leads", { params: { path: { id: "card-1" } } }));

    put.mockResolvedValue({ data: { ...lead, spam: true } });
    fireEvent.click(screen.getByTestId("stub-spam"));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/api/leads/{id}/spam", { params: { path: { id: "lead-1" } }, body: { spam: true } }),
    );
    del.mockResolvedValue({});
    fireEvent.click(screen.getByTestId("stub-remove"));
    await waitFor(() => expect(del).toHaveBeenCalledWith("/api/leads/{id}", { params: { path: { id: "lead-1" } } }));
  });

  test("LEA-021 LNK-008 the toolbar exports the whole card, whatever its status", async () => {
    get.mockResolvedValue({ data: cardView({ id: "card-1", status: "disabled" }) });
    renderWithIntl(<CardLeadsPage />);
    expect(await screen.findByTestId("export-stub")).toHaveTextContent("card:card-1");
  });

  test("ACC-017 the card of someone else or a missing one reads as « Carte introuvable »", async () => {
    get.mockRejectedValue(new ApiError({ status: 404, code: "not_found", message: "No such card.", requestId: "r1" }));
    renderWithIntl(<CardLeadsPage />);
    expect(await screen.findByTestId("card-not-found")).toHaveTextContent("Carte introuvable");
    expect(screen.queryByTestId("lead-list-stub")).toBeNull();
  });
});
