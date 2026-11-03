import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import messages from "../../../../messages/fr.json";
import { AuthContext } from "@/lib/auth/context";
import type { AuthContextValue } from "@/lib/auth/types";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import LoginPage from "./page";

function renderLogin(status: AuthContextValue["status"]) {
  const value: AuthContextValue = {
    status,
    user: status === "signed-in" ? { subject: "seed-alice", name: "Alice" } : null,
    getToken: async () => null,
    signIn: async () => undefined,
    signOut: async () => undefined,
  };
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AuthContext.Provider value={value}>
        <LoginPage />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  replace.mockReset();
});

describe("LoginPage", () => {
  test("ACC-001: redirects to the dashboard once signed in", async () => {
    renderLogin("signed-in");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(screen.getByTestId("login-to-dashboard")).toHaveAttribute("href", "/dashboard");
  });

  test.each(["loading", "signed-out"] as const)("ACC-001: does not redirect while %s", (status) => {
    renderLogin(status);
    expect(replace).not.toHaveBeenCalled();
  });
});
