import { ApiError } from "@cartouche/api-client";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { cardView } from "@/components/cards/card-view.fixture";
import { renderWithIntl } from "@/components/editor/test-helpers";
import EditCardPage from "./page";

const get = vi.fn();
vi.mock("@/lib/api", () => ({ useApi: () => ({ GET: get }) }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "card-1" }) }));
vi.mock("@/components/account/AccountGate", () => ({ AccountGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/editor/CardEditor", () => ({
  CardEditor: ({ card }: { card: { slug: string } }) => <p data-testid="editor-stub">{card.slug}</p>,
}));

beforeEach(() => {
  get.mockReset();
});

describe("EditCardPage", () => {
  test("EDI-003 loads the card by the id of the address and opens the editor", async () => {
    get.mockResolvedValue({ data: cardView({ slug: "alice-durand" }) });
    renderWithIntl(<EditCardPage />);
    expect(screen.getByTestId("editor-loading")).toBeVisible();
    expect(await screen.findByTestId("editor-stub")).toHaveTextContent("alice-durand");
    expect(get).toHaveBeenCalledWith("/api/cards/{id}", { params: { path: { id: "card-1" } } });
  });

  test("ACC-017 the card of someone else or a missing one reads as « Carte introuvable »", async () => {
    get.mockRejectedValue(new ApiError({ status: 404, code: "not_found", message: "No such card.", requestId: "r1" }));
    renderWithIntl(<EditCardPage />);
    expect(await screen.findByTestId("card-not-found")).toHaveTextContent("Carte introuvable");
    expect(screen.queryByTestId("editor-stub")).toBeNull();
  });

  test("EDI-003 any other failure shows the generic notice with the request id", async () => {
    get.mockRejectedValue(new ApiError({ status: 500, code: "internal_error", message: "Boom.", requestId: "req-1" }));
    renderWithIntl(<EditCardPage />);
    expect(await screen.findByTestId("error-notice")).toBeVisible();
    expect(screen.getByTestId("error-request-id")).toHaveTextContent("req-1");
  });
});
