import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test, vi } from "vitest";
import messages from "../../../messages/fr.json";
import { AuthContext } from "./context";
import { TestLoginPanel } from "./TestLoginPanel";
import { BASE_TEST_USERS } from "./test-users";
import type { AuthContextValue } from "./types";

function renderPanel(signIn: AuthContextValue["signIn"]) {
  const value: AuthContextValue = {
    status: "signed-out",
    user: null,
    getToken: async () => null,
    signIn,
    signOut: async () => undefined,
  };
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AuthContext.Provider value={value}>
        <TestLoginPanel />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("TestLoginPanel", () => {
  test("ACC-015: one login button per base scenario user", () => {
    renderPanel(async () => undefined);
    for (const user of BASE_TEST_USERS) {
      expect(screen.getByTestId(`login-as-${user.subject}`)).toHaveTextContent(user.name);
    }
    expect(BASE_TEST_USERS).toHaveLength(6);
  });

  test("ACC-015: clicking a user signs in as that subject", () => {
    const signIn = vi.fn(async () => undefined);
    renderPanel(signIn);
    fireEvent.click(screen.getByTestId("login-as-seed-bob"));
    expect(signIn).toHaveBeenCalledWith({ subject: "seed-bob" });
  });

  test("ACC-015: free subject form signs in with the typed subject", () => {
    const signIn = vi.fn(async () => undefined);
    renderPanel(signIn);
    fireEvent.change(screen.getByTestId("login-free-subject"), { target: { value: "seed-zoe" } });
    fireEvent.click(screen.getByTestId("login-free-subject-submit"));
    expect(signIn).toHaveBeenCalledWith({ subject: "seed-zoe" });
  });

  test("ACC-015: shows an error when sign in fails", async () => {
    renderPanel(async () => {
      throw new Error("boom");
    });
    fireEvent.click(screen.getByTestId("login-as-seed-alice"));
    await waitFor(() => expect(screen.getByTestId("login-error")).toBeInTheDocument());
  });
});
