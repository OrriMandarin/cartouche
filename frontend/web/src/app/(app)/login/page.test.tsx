import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import messages from "../../../../messages/fr.json";
import { privacyUrl, termsUrl } from "@/lib/instance-links";
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

  test("ACC-025 the sign-in page links to the terms and the privacy policy", () => {
    renderLogin("signed-out");
    const terms = screen.getByRole("link", { name: "Conditions générales d’utilisation" });
    const privacy = screen.getByRole("link", { name: "Politique de confidentialité" });
    expect(terms).toHaveAttribute("href", termsUrl());
    expect(privacy).toHaveAttribute("href", privacyUrl());
    expect(terms.parentElement).toHaveTextContent("En continuant, tu acceptes les Conditions générales d’utilisation et la Politique de confidentialité.");
  });

  test("the sign-in page shows the tagline and the three arguments", () => {
    renderLogin("signed-out");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ta carte de visite, toujours à jour.");
    expect(screen.getByText("Un tag NFC ou un QR code")).toBeInTheDocument();
    expect(screen.getByText("Une page à ton image")).toBeInTheDocument();
    expect(screen.getByText("Les contacts de tes salons, au même endroit")).toBeInTheDocument();
  });

  test.each(["loading", "signed-out"] as const)("ACC-001: does not redirect while %s", (status) => {
    renderLogin(status);
    expect(replace).not.toHaveBeenCalled();
  });
});
