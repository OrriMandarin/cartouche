import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "@cartouche/api-client";
import messages from "../../../messages/fr.json";
import { supportMailto } from "@/lib/instance-links";
import { AuthContext } from "@/lib/auth/context";
import type { AuthContextValue } from "@/lib/auth/types";

const get = vi.fn();
const api = { GET: get, DELETE: vi.fn() };
vi.mock("@/lib/api", () => ({ useApi: () => api }));
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), usePathname: () => "/dashboard" }));

import { AccountGate, useMe } from "./AccountGate";

function me(status: string, extra: Record<string, unknown> = {}) {
  return { data: { id: "u1", email: "alice@example.test", display_name: "Alice", status, is_admin: false, totals: { cards: 0, events: 0, leads: 0 }, ...extra } };
}

function Child() {
  const m = useMe();
  return <p data-testid="child">{m.email}</p>;
}

function renderGate(auth: Partial<AuthContextValue> = {}) {
  const value: AuthContextValue = {
    status: "signed-in",
    user: { subject: "seed-alice", name: "Alice" },
    getToken: async () => "tok",
    signIn: async () => undefined,
    signOut: async () => undefined,
    ...auth,
  };
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AuthContext.Provider value={value}>
        <AccountGate>
          <Child />
        </AccountGate>
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  replace.mockReset();
});

describe("AccountGate", () => {
  test.each([
    ["pending", "account-pending"],
    ["rejected", "account-rejected"],
    ["suspended", "account-suspended"],
  ])("ACC-004: shows %s notice and hides children", async (status, testId) => {
    get.mockResolvedValue(me(status));
    renderGate();
    expect(await screen.findByTestId(testId)).toBeInTheDocument();
    expect(screen.queryByTestId("child")).toBeNull();
  });

  test("ACC-011: pending notice says the account awaits validation", async () => {
    get.mockResolvedValue(me("pending"));
    renderGate();
    expect(await screen.findByTestId("account-pending")).toHaveTextContent("Ton compte est en attente de validation");
  });

  test.each([
    {
      status: "pending",
      testId: "account-pending",
      badge: "En attente",
      title: "Ton compte est en attente de validation",
      text: "Merci pour ton inscription. Nous validons chaque nouveau compte à la main\u00a0: tu pourras utiliser Cartouche avec alice@example.test dès qu’il sera activé.",
      support: false,
    },
    {
      status: "rejected",
      testId: "account-rejected",
      badge: "Inscription refusée",
      title: "Ton inscription n’a pas été acceptée",
      text: "Ce compte ne peut pas utiliser Cartouche. Si tu penses qu’il s’agit d’une erreur, écris-nous\u00a0: nous reverrons ta demande.",
      support: true,
    },
    {
      status: "suspended",
      testId: "account-suspended",
      badge: "Suspendu",
      title: "Ton compte est suspendu",
      text: "Tu ne peux plus modifier tes cartes pour le moment. Contacte le support pour connaître la raison et la marche à suivre.",
      support: true,
    },
  ])("ACC-026 the $status account has its badge, title, text and actions", async (c) => {
    get.mockResolvedValue(me(c.status));
    renderGate();
    const card = await screen.findByTestId(c.testId);
    expect(card).toHaveTextContent(c.badge);
    expect(within(card).getByRole("heading", { level: 1 })).toHaveTextContent(c.title);
    // textContent, not toHaveTextContent: the latter would hide the non-breaking space of the text.
    expect(card.textContent).toContain(c.text);
    expect(within(card).getByTestId("sign-out")).toHaveTextContent("Se déconnecter");
    const support = within(card).queryByTestId("account-support");
    if (c.support) {
      expect(support).toHaveTextContent("Contacter le support");
      expect(support).toHaveAttribute("href", supportMailto());
    } else {
      expect(support).toBeNull();
    }
  });

  test("ACC-026 the pending text does not mention an email the account does not have", async () => {
    get.mockResolvedValue(me("pending", { email: "" }));
    renderGate();
    expect((await screen.findByTestId("account-pending")).textContent).toContain(
      "tu pourras utiliser Cartouche dès que ton compte sera activé.",
    );
  });

  test("ACC-004: renders children when approved", async () => {
    get.mockResolvedValue(me("approved"));
    renderGate();
    expect(await screen.findByTestId("child")).toHaveTextContent("alice@example.test");
    expect(get).toHaveBeenCalledWith("/api/me");
  });

  test("shows a skeleton while loading", () => {
    get.mockReturnValue(new Promise(() => undefined));
    renderGate();
    expect(screen.getByTestId("account-loading")).toBeInTheDocument();
  });

  test("redirects to /login when signed out, without calling the API", async () => {
    renderGate({ status: "signed-out", user: null });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByTestId("child")).toBeNull();
  });

  test("shows signup-closed notice on 403 signup_closed", async () => {
    get.mockRejectedValue(new ApiError({ status: 403, code: "signup_closed", message: "closed", requestId: "r-1" }));
    renderGate();
    expect(await screen.findByTestId("signup-closed")).toBeInTheDocument();
    expect(screen.queryByTestId("child")).toBeNull();
  });

  test("shows request id on unexpected error", async () => {
    get.mockRejectedValue(new ApiError({ status: 500, code: "internal", message: "boom", requestId: "req-abc-123" }));
    renderGate();
    expect(await screen.findByTestId("error-request-id")).toHaveTextContent("req-abc-123");
    expect(screen.queryByTestId("child")).toBeNull();
  });

  test("the shell shows the signed-in name and signs out", async () => {
    get.mockResolvedValue(me("approved"));
    const signOut = vi.fn(async () => undefined);
    renderGate({ signOut });
    await screen.findByTestId("child");
    expect(screen.getByTestId("shell-user-name")).toHaveTextContent("Alice");
    fireEvent.click(screen.getByTestId("sign-out"));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test("ACC-004: header with sign-out stays available on the pending screen", async () => {
    get.mockResolvedValue(me("pending"));
    renderGate();
    await screen.findByTestId("account-pending");
    expect(screen.getByTestId("account-header")).toHaveTextContent("alice@example.test");
    expect(screen.queryByTestId("account-link")).toBeNull();
    expect(screen.getByTestId("sign-out")).toBeInTheDocument();
  });

  test("ACC-019 EDI-022 the navigation links to Mon compte", async () => {
    get.mockResolvedValue(me("approved"));
    renderGate();
    await screen.findByTestId("child");
    const link = screen.getByTestId("account-link");
    expect(link).toHaveTextContent("Mon compte");
    expect(link).toHaveAttribute("href", "/dashboard/account");
  });

  test.each(["pending", "rejected", "suspended"])(
    "ACC-019 ACC-021 a %s account is offered the deletion",
    async (status) => {
      get.mockResolvedValue(me(status));
      renderGate();
      await screen.findByTestId(`account-${status}`);
      fireEvent.click(screen.getByTestId("delete-account-open"));
      expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
      expect(screen.getByTestId("delete-account-confirm")).toBeDisabled();
    },
  );

  test("ACC-021 the admin explanation is not shown to a non-admin pending account", async () => {
    get.mockResolvedValue(me("pending"));
    renderGate();
    await screen.findByTestId("account-pending");
    expect(screen.queryByTestId("delete-account-admin")).toBeNull();
  });
});
