import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => <div data-testid="clerk-provider">{children}</div>,
  useAuth: () => ({ isLoaded: true, isSignedIn: false, getToken: async () => null }),
  useUser: () => ({ isLoaded: true, user: null }),
  useClerk: () => ({ signOut: async () => undefined }),
}));

vi.mock("oidc-client-ts", () => ({
  UserManager: class {
    events = {
      addUserLoaded: () => undefined,
      addUserUnloaded: () => undefined,
      removeUserLoaded: () => undefined,
      removeUserUnloaded: () => undefined,
      addAccessTokenExpired: () => undefined,
      removeAccessTokenExpired: () => undefined,
    };
    getUser = async () => null;
    signinRedirect = async () => undefined;
    signoutRedirect = async () => undefined;
    removeUser = async () => undefined;
  },
  WebStorageStateStore: class {},
}));

async function loadAuthModules() {
  vi.resetModules();
  const { AuthProvider } = await import("./AuthProvider");
  const { useAuth } = await import("./context");
  function Probe() {
    const auth = useAuth();
    return (
      <div>
        <span data-testid="status">{auth.status}</span>
        <span data-testid="subject">{auth.user?.subject ?? ""}</span>
      </div>
    );
  }
  return { AuthProvider, useAuth, Probe };
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AuthProvider", () => {
  test("ACC-014: useAuth outside provider throws", async () => {
    const { useAuth } = await loadAuthModules();
    function Bare() {
      useAuth();
      return null;
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Bare />)).toThrow(/AuthProvider/);
    spy.mockRestore();
  });

  test("ACC-014: selects test adapter when NEXT_PUBLIC_AUTH_PROVIDER=test", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDER", "test");
    vi.stubEnv("NEXT_PUBLIC_CARTOUCHE_BUILD_PROFILE", "test");
    sessionStorage.setItem("cartouche.test.token", "tok");
    sessionStorage.setItem("cartouche.test.subject", "seed-alice");
    const { AuthProvider, Probe } = await loadAuthModules();

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText("seed-alice")).toBeInTheDocument();
    expect(screen.getByTestId("status")).toHaveTextContent("signed-in");
    expect(screen.queryByTestId("clerk-provider")).toBeNull();
  });

  test("ACC-014: selects clerk adapter by default", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDER", "");
    const { AuthProvider, Probe } = await loadAuthModules();

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByTestId("clerk-provider")).toBeInTheDocument();
    expect(await screen.findByText("signed-out")).toBeInTheDocument();
  });

  test("ACC-014: selects oidc adapter when NEXT_PUBLIC_AUTH_PROVIDER=oidc", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDER", "oidc");
    vi.stubEnv("NEXT_PUBLIC_OIDC_AUTHORITY", "https://idp.example.test");
    vi.stubEnv("NEXT_PUBLIC_OIDC_CLIENT_ID", "cartouche");
    const { AuthProvider, Probe } = await loadAuthModules();

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText("signed-out")).toBeInTheDocument();
    expect(screen.queryByTestId("clerk-provider")).toBeNull();
  });

  test("ACC-008: test adapter is unavailable with the production profile", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDER", "test");
    vi.stubEnv("NEXT_PUBLIC_CARTOUCHE_BUILD_PROFILE", "production");
    const { AuthProvider, Probe } = await loadAuthModules();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() =>
      render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      ),
    ).toThrow(/test auth provider/i);
    spy.mockRestore();
  });
});
