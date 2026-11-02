import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "@cartouche/api-client";
import messages from "../../../messages/fr.json";
import { AuthContext } from "@/lib/auth/context";
import type { AuthContextValue } from "@/lib/auth/types";

const get = vi.fn();
const api = { GET: get };
vi.mock("@/lib/api", () => ({ useApi: () => api }));
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import { AccountGate, useMe } from "./AccountGate";

function me(status: string, extra: Record<string, unknown> = {}) {
  return { data: { id: "u1", email: "alice@example.test", display_name: "Alice", status, is_admin: false, ...extra } };
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

  test("header shows the signed-in name and signs out", async () => {
    get.mockResolvedValue(me("approved"));
    const signOut = vi.fn(async () => undefined);
    renderGate({ signOut });
    await screen.findByTestId("child");
    expect(screen.getByTestId("account-header")).toHaveTextContent("Alice");
    fireEvent.click(screen.getByTestId("sign-out"));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test("ACC-004: header with sign-out stays available on the pending screen", async () => {
    get.mockResolvedValue(me("pending"));
    renderGate();
    await screen.findByTestId("account-pending");
    expect(screen.getByTestId("sign-out")).toBeInTheDocument();
  });
});
