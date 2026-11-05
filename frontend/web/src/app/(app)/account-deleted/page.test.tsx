import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";
import messages from "../../../../messages/fr.json";
import { AuthContext } from "@/lib/auth/context";

import AccountDeletedPage from "./page";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AccountDeletedPage", () => {
  test("ACC-023 the deleted page signs out without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const signOut = vi.fn(async () => undefined);
    const { rerender } = render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <AuthContext.Provider
          value={{
            status: "signed-in",
            user: { subject: "seed-bob" },
            getToken: async () => "tok",
            signIn: async () => undefined,
            signOut,
          }}
        >
          <AccountDeletedPage />
        </AuthContext.Provider>
      </NextIntlClientProvider>,
    );

    expect(screen.getByTestId("account-deleted")).toHaveTextContent("Ton compte a été supprimé");
    expect(screen.getByTestId("account-deleted")).toHaveTextContent("fournisseur d’identité");
    expect(screen.getByTestId("account-deleted-home")).toHaveAttribute("href", "/");
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(signOut).toHaveBeenCalledWith({ redirectTo: "/account-deleted" });

    // Signing out changes the auth state: the page re-renders but does not sign out a second time.
    rerender(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <AuthContext.Provider
          value={{
            status: "signed-out",
            user: null,
            getToken: async () => null,
            signIn: async () => undefined,
            signOut,
          }}
        >
          <AccountDeletedPage />
        </AuthContext.Provider>
      </NextIntlClientProvider>,
    );
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("ACC-023 coming back signed out does not sign out again, nor call the API", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const signOut = vi.fn(async () => undefined);
    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <AuthContext.Provider
          value={{
            status: "signed-out",
            user: null,
            getToken: async () => null,
            signIn: async () => undefined,
            signOut,
          }}
        >
          <AccountDeletedPage />
        </AuthContext.Provider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("account-deleted")).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
