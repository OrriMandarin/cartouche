import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import messages from "../../../messages/fr.json";
import { AuthContext } from "@/lib/auth/context";

const get = vi.fn();
const post = vi.fn();
const api = { GET: get, POST: post };
vi.mock("@/lib/api", () => ({ useApi: () => api }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import SupportPage from "./page";

const carol = {
  id: "id-carol",
  subject: "seed-carol",
  email: "carol@example.test",
  display_name: "Carol",
  status: "pending",
  is_admin: false,
  created_at: "2026-03-05T12:00:00Z",
};
const counts = { pending: 1, approved: 3, rejected: 0, suspended: 2 };

function renderPage() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AuthContext.Provider
        value={{
          status: "signed-in",
          user: { subject: "seed-admin" },
          getToken: async () => "tok",
          signIn: async () => undefined,
          signOut: async () => undefined,
        }}
      >
        <SupportPage />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("SupportPage", () => {
  test("ADM-001: non-admins see the restricted notice and no admin request is made", async () => {
    get.mockResolvedValue({ data: { id: "u", email: "a@example.test", status: "approved", is_admin: false } });
    renderPage();
    expect(await screen.findByTestId("support-forbidden")).toHaveTextContent("Accès réservé");
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/api/me");
  });

  test("ADM-002: lists pending users with per-status counters, and reloads after an action", async () => {
    get.mockImplementation(async (path: string) => {
      if (path === "/api/me") return { data: { id: "a", status: "approved", is_admin: true } };
      return { data: { users: [carol], counts } };
    });
    post.mockResolvedValue({ data: {} });
    renderPage();

    expect(await screen.findByTestId("user-row-seed-carol")).toBeInTheDocument();
    expect(screen.getByTestId("count-pending")).toHaveTextContent("1");
    expect(screen.getByTestId("count-approved")).toHaveTextContent("3");
    expect(screen.getByTestId("count-suspended")).toHaveTextContent("2");
    expect(get).toHaveBeenCalledWith("/api/admin/users", { params: { query: { status: "pending" } } });

    const callsBefore = get.mock.calls.length;
    fireEvent.click(screen.getByTestId("set-status-seed-carol-approved"));
    await waitFor(() => expect(get.mock.calls.length).toBe(callsBefore + 1));
    expect(post).toHaveBeenCalledTimes(1);
  });
});
