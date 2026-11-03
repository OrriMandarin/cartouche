import { ApiError } from "@cartouche/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { cardView } from "@/components/cards/card-view.fixture";
import { renderWithIntl } from "@/components/editor/test-helpers";
import SupportCardPage from "./page";

const get = vi.fn();
const post = vi.fn();
let isAdmin = true;
vi.mock("@/lib/api", () => ({ useApi: () => ({ GET: get, POST: post }) }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "card-1" }) }));
vi.mock("@/components/account/AccountGate", () => ({
  AccountGate: ({ children }: { children: React.ReactNode }) => children,
  useMe: () => ({ is_admin: isAdmin }),
}));

const owner = {
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
  post.mockReset();
  isAdmin = true;
});

describe("SupportCardPage", () => {
  test("ADM-012 ADM-013 shows the card in the template preview, with no field to edit", async () => {
    get.mockResolvedValue({
      data: { card: cardView({ content: { first_name: "Éloïse", job_title: "Ancien poste" } }), owner },
    });
    const { container } = renderWithIntl(<SupportCardPage />);

    expect(await screen.findByTestId("card-name")).toHaveTextContent("Éloïse");
    expect(screen.getByTestId("card-job-title")).toHaveTextContent("Ancien poste");
    expect(get).toHaveBeenCalledWith("/api/admin/cards/{id}", { params: { path: { id: "card-1" } } });
    expect(container.querySelectorAll("input, textarea, select, [contenteditable]")).toHaveLength(0);
    expect(screen.getByTestId("support-card-owner")).toHaveAttribute("href", "/support/users/user-alice");
    expect(screen.getByTestId("support-card-public-link")).toHaveAttribute(
      "href",
      "http://localhost:13000/c/alice-durand",
    );
  });

  test("ADM-009 after disabling, the card is reloaded and offers to lift the block", async () => {
    get
      .mockResolvedValueOnce({ data: { card: cardView(), owner } })
      .mockResolvedValueOnce({ data: { card: cardView({ status: "disabled_by_support" }), owner } });
    post.mockResolvedValue({ data: {} });
    renderWithIntl(<SupportCardPage />);

    fireEvent.click(await screen.findByTestId("support-card-disable"));
    expect(await screen.findByTestId("support-card-enable")).toBeEnabled();
    expect(screen.getByTestId("card-status-alice-durand")).toHaveTextContent("Désactivée par le support");
    expect(post).toHaveBeenCalledWith("/api/admin/cards/{id}/support-disable", {
      params: { path: { id: "card-1" } },
    });
  });

  test("ADM-001 a non-administrator sees « Accès réservé » and no admin request is made", () => {
    isAdmin = false;
    renderWithIntl(<SupportCardPage />);
    expect(screen.getByTestId("support-forbidden")).toHaveTextContent("Accès réservé");
    expect(get).not.toHaveBeenCalled();
  });

  test("ADM-006 ADM-013 an unknown card reads as « Carte introuvable »", async () => {
    get.mockRejectedValue(new ApiError({ status: 404, code: "not_found", message: "No.", requestId: "r1" }));
    renderWithIntl(<SupportCardPage />);
    await waitFor(() => expect(screen.getByTestId("support-not-found")).toHaveTextContent("Carte introuvable"));
  });

  test("ADM-013 any other failure shows the generic notice with the request id", async () => {
    get.mockRejectedValue(new ApiError({ status: 500, code: "internal_error", message: "Boom.", requestId: "req-1" }));
    renderWithIntl(<SupportCardPage />);
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-1");
  });
});
