import { ApiError } from "@cartouche/api-client";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { cardView } from "@/components/cards/card-view.fixture";
import { renderWithIntl } from "@/components/editor/test-helpers";
import SupportUserPage from "./page";

const get = vi.fn();
let isAdmin = true;
vi.mock("@/lib/api", () => ({ useApi: () => ({ GET: get }) }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "user-alice" }) }));
vi.mock("@/components/account/AccountGate", () => ({
  AccountGate: ({ children }: { children: React.ReactNode }) => children,
  useMe: () => ({ is_admin: isAdmin }),
}));

const alice = {
  id: "user-alice",
  subject: "seed-alice",
  email: "alice@example.test",
  display_name: "Alice",
  status: "approved",
  is_admin: false,
  created_at: "2026-03-05T12:00:00Z",
};

beforeEach(() => {
  get.mockReset();
  isAdmin = true;
});

describe("SupportUserPage", () => {
  test("ADM-006 ADM-013 loads the account by the id of the address and lists its cards", async () => {
    get.mockResolvedValue({ data: { user: alice, cards: [cardView({ slug: "alice-durand" })] } });
    renderWithIntl(<SupportUserPage />);
    expect(await screen.findByTestId("support-card-row-alice-durand")).toBeVisible();
    expect(screen.getByTestId("support-user-email")).toHaveTextContent("alice@example.test");
    expect(get).toHaveBeenCalledWith("/api/admin/users/{id}", { params: { path: { id: "user-alice" } } });
  });

  test("ADM-001 a non-administrator sees « Accès réservé » and no admin request is made", () => {
    isAdmin = false;
    renderWithIntl(<SupportUserPage />);
    expect(screen.getByTestId("support-forbidden")).toHaveTextContent("Accès réservé");
    expect(get).not.toHaveBeenCalled();
  });

  test("an unknown or malformed id reads as « Utilisateur introuvable »", async () => {
    get.mockRejectedValue(new ApiError({ status: 400, code: "invalid_request", message: "No.", requestId: "r1" }));
    renderWithIntl(<SupportUserPage />);
    expect(await screen.findByTestId("support-not-found")).toHaveTextContent("Utilisateur introuvable");
  });
});
