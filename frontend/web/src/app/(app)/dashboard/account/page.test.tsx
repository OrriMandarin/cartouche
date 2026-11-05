import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import messages from "../../../../../messages/fr.json";
import { AuthContext } from "@/lib/auth/context";

const get = vi.fn();
const signOut = vi.fn(async () => undefined);
const api = { GET: get, DELETE: vi.fn() };
vi.mock("@/lib/api", () => ({ useApi: () => api }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/dashboard/account" }));

import AccountPage from "./page";

function me(extra: Record<string, unknown> = {}) {
  return {
    data: { id: "u1", email: "alice@example.test", display_name: "Alice Durand", status: "approved", is_admin: false, totals: { cards: 4, events: 7, leads: 164 }, ...extra },
  };
}

function renderPage(auth: Record<string, unknown> = {}, user: Record<string, unknown> = {}) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AuthContext.Provider
        value={{
          status: "signed-in",
          user: { subject: "seed-alice", ...user },
          getToken: async () => "tok",
          signIn: async () => undefined,
          signOut,
          ...auth,
        }}
      >
        <AccountPage />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  signOut.mockClear();
});

describe("AccountPage", () => {
  test("ACC-019 shows the email and display name, and offers the deletion", async () => {
    get.mockResolvedValue(me());
    renderPage();
    expect(await screen.findByTestId("account-email")).toHaveTextContent("alice@example.test");
    expect(screen.getByTestId("account-display-name")).toHaveTextContent("Alice Durand");
    fireEvent.click(screen.getByTestId("delete-account-open"));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
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

  test("ACC-027 the deletion area gives the counts and links to the contacts", async () => {
    get.mockResolvedValue(me());
    renderPage();
    const zone = await screen.findByTestId("delete-account-zone");
    expect(zone.textContent).toContain(
      "Supprime définitivement ton compte et toutes ses données\u00a0: 4 cartes, 7 événements et 164 contacts. Les liens de tes cartes, tags NFC et QR codes compris, cesseront de fonctionner.",
    );
    const exportLink = screen.getByRole("link", { name: "Exporter mes contacts d’abord" });
    expect(exportLink).toHaveAttribute("href", "/dashboard/contacts");
    expect(screen.getByTestId("delete-account-open")).toHaveTextContent("Supprimer mon compte…");
  });

  test.each([
    [{ cards: 0, events: 0, leads: 0 }, "0 carte, 0 événement et 0 contact"],
    [{ cards: 1, events: 1, leads: 1 }, "1 carte, 1 événement et 1 contact"],
    [{ cards: 2, events: 0, leads: 1 }, "2 cartes, 0 événement et 1 contact"],
    [{ cards: 1, events: 12, leads: 1500 }, "1 carte, 12 événements et 1\u202f500 contacts"],
  ])("ACC-027 the counts %j read correctly in French", async (totals, expected) => {
    get.mockResolvedValue(me({ totals }));
    renderPage();
    expect(await screen.findByTestId("delete-account-summary")).toHaveTextContent(expected.replace("\u202f", " "));
    expect(screen.getByTestId("delete-account-summary").textContent).toContain(`\u00a0: ${expected}.`);
  });

  test("ACC-027 the confirmation dialog lists what disappears, with the same counts", async () => {
    get.mockResolvedValue(me());
    renderPage();
    fireEvent.click(await screen.findByTestId("delete-account-open"));
    const dialog = await screen.findByRole("alertdialog", { name: "Supprimer ton compte\u00a0?" });
    expect(dialog.textContent).toContain("Tout sera supprimé, sans retour possible\u00a0:");
    const items = within(dialog).getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual([
      "tes 4 cartes et leurs pages publiques\u00a0;",
      "tes 7 événements et leurs formulaires\u00a0;",
      "les 164 contacts collectés.",
    ]);
  });

  test("ACC-019 the profile shows the name, the email and how the user signed in", async () => {
    get.mockResolvedValue(me());
    renderPage({}, { provider: "google" });
    expect(await screen.findByTestId("account-sign-in-provider")).toHaveTextContent("Connexion avec Google");
  });

  test("ACC-019 the sign-in provider line and the profile button need an adapter that has them", async () => {
    get.mockResolvedValue(me());
    renderPage();
    await screen.findByTestId("account-email");
    expect(screen.queryByTestId("account-sign-in-provider")).toBeNull();
    expect(screen.queryByTestId("account-manage-profile")).toBeNull();
  });

  test("ACC-019 « Gérer l’e-mail et la connexion » opens the identity provider's profile", async () => {
    const manageProfile = vi.fn();
    get.mockResolvedValue(me());
    renderPage({ manageProfile });
    fireEvent.click(await screen.findByRole("button", { name: "Gérer l’e-mail et la connexion" }));
    expect(manageProfile).toHaveBeenCalledTimes(1);
  });

  test("ACC-019 the account page offers the sign-out", async () => {
    get.mockResolvedValue(me());
    renderPage();
    fireEvent.click(await screen.findByTestId("account-sign-out"));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
