import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import messages from "../../../../../messages/fr.json";
import { AuthContext } from "@/lib/auth/context";

const get = vi.fn();
const api = { GET: get, DELETE: vi.fn() };
vi.mock("@/lib/api", () => ({ useApi: () => api }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/dashboard/account" }));

import AccountPage from "./page";

function me(extra: Record<string, unknown> = {}) {
  return {
    data: { id: "u1", email: "alice@example.test", display_name: "Alice Durand", status: "approved", is_admin: false, ...extra },
  };
}

function renderPage() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AuthContext.Provider
        value={{
          status: "signed-in",
          user: { subject: "seed-alice" },
          getToken: async () => "tok",
          signIn: async () => undefined,
          signOut: async () => undefined,
        }}
      >
        <AccountPage />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
});

describe("AccountPage", () => {
  test("ACC-019 shows the email and display name, and offers the deletion", async () => {
    get.mockResolvedValue(me());
    renderPage();
    expect(await screen.findByTestId("account-email")).toHaveTextContent("alice@example.test");
    expect(screen.getByTestId("account-display-name")).toHaveTextContent("Alice Durand");
    fireEvent.click(screen.getByTestId("delete-account-open"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  test("ACC-019 an account without an email shows Non renseigné like a missing display name", async () => {
    get.mockResolvedValue(me({ email: null, display_name: null }));
    renderPage();
    expect(await screen.findByTestId("account-email")).toHaveTextContent("Non renseigné");
    expect(screen.getByTestId("account-display-name")).toHaveTextContent("Non renseigné");
  });

  test("ACC-021 an administrator is told why there is no deletion", async () => {
    get.mockResolvedValue(me({ is_admin: true }));
    renderPage();
    expect(await screen.findByTestId("delete-account-admin")).toBeInTheDocument();
    expect(screen.queryByTestId("delete-account-open")).toBeNull();
  });
});
