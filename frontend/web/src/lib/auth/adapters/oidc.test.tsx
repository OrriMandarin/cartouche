import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type Handler = (...args: unknown[]) => void;

// Shared state the mocked UserManager reads from, reset for every test.
const fake = {
  user: null as { expired: boolean; access_token: string; profile: { sub: string } } | null,
  signinSilent: vi.fn(),
  handlers: { loaded: new Set<Handler>(), unloaded: new Set<Handler>(), expired: new Set<Handler>() },
};

vi.mock("oidc-client-ts", () => ({
  WebStorageStateStore: class {},
  UserManager: class {
    events = {
      addUserLoaded: (h: Handler) => fake.handlers.loaded.add(h),
      removeUserLoaded: (h: Handler) => fake.handlers.loaded.delete(h),
      addUserUnloaded: (h: Handler) => fake.handlers.unloaded.add(h),
      removeUserUnloaded: (h: Handler) => fake.handlers.unloaded.delete(h),
      addAccessTokenExpired: (h: Handler) => fake.handlers.expired.add(h),
      removeAccessTokenExpired: (h: Handler) => fake.handlers.expired.delete(h),
    };
    getUser = async () => fake.user;
    signinSilent = (...args: unknown[]) => fake.signinSilent(...args);
    // Like the real library: removing the user fires userUnloaded.
    removeUser = async () => {
      fake.user = null;
      fake.handlers.unloaded.forEach((h) => h());
    };
  },
}));

async function setup() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_OIDC_AUTHORITY", "https://idp.example.test");
  vi.stubEnv("NEXT_PUBLIC_OIDC_CLIENT_ID", "cartouche");
  const { OidcAuthAdapter } = await import("./oidc");
  const { useAuth } = await import("../context");
  let current: ReturnType<typeof useAuth> | undefined;
  function Probe() {
    const auth = useAuth();
    current = auth;
    return <span data-testid="status">{auth.status}</span>;
  }
  render(
    <OidcAuthAdapter>
      <Probe />
    </OidcAuthAdapter>,
  );
  return { auth: () => current! };
}

beforeEach(() => {
  fake.user = { expired: false, access_token: "at", profile: { sub: "u1" } };
  fake.signinSilent = vi.fn();
  fake.handlers.loaded.clear();
  fake.handlers.unloaded.clear();
  fake.handlers.expired.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OidcAuthAdapter token expiry", () => {
  test("ACC-014: valid token is returned and status is signed-in", async () => {
    const { auth } = await setup();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));
    await expect(auth().getToken()).resolves.toBe("at");
  });

  test("ACC-014: expired token with failing silent renew returns null and signs out", async () => {
    const { auth } = await setup();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));
    fake.user = { expired: true, access_token: "old", profile: { sub: "u1" } };
    fake.signinSilent.mockRejectedValue(new Error("login_required"));

    let token: string | null = "unset";
    await act(async () => {
      token = await auth().getToken();
    });

    expect(token).toBeNull();
    expect(fake.signinSilent).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-out"));
  });

  test("ACC-014: expired token renewed with a refresh token yields the new access token", async () => {
    const { auth } = await setup();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));
    fake.user = { expired: true, access_token: "old", profile: { sub: "u1" } };
    fake.signinSilent.mockResolvedValue({ expired: false, access_token: "new", profile: { sub: "u1" } });

    await expect(auth().getToken()).resolves.toBe("new");
    expect(screen.getByTestId("status")).toHaveTextContent("signed-in");
  });

  test("ACC-014: accessTokenExpired event with failing renew signs out", async () => {
    await setup();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));
    fake.user = { expired: true, access_token: "old", profile: { sub: "u1" } }; // as when the event fires
    fake.signinSilent.mockRejectedValue(new Error("login_required"));

    await act(async () => {
      fake.handlers.expired.forEach((h) => h());
    });

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-out"));
    expect(fake.signinSilent).toHaveBeenCalledTimes(1);
  });

  test("ACC-014: accessTokenExpired event with a successful renew stays signed-in", async () => {
    await setup();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));
    fake.user = { expired: true, access_token: "old", profile: { sub: "u1" } }; // as when the event fires
    fake.signinSilent.mockResolvedValue({ expired: false, access_token: "new", profile: { sub: "u1" } });

    await act(async () => {
      fake.handlers.expired.forEach((h) => h());
    });

    expect(screen.getByTestId("status")).toHaveTextContent("signed-in");
  });

  test("ACC-014: concurrent expired getToken calls and expiry event renew once", async () => {
    const { auth } = await setup();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));
    fake.user = { expired: true, access_token: "old", profile: { sub: "u1" } };
    let finish!: () => void;
    const renewed = { expired: false, access_token: "new", profile: { sub: "u1" } };
    fake.signinSilent.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            fake.user = renewed; // the real library stores the renewed user
            resolve(renewed);
          };
        }),
    );

    let tokens: (string | null)[] = [];
    const pending = act(async () => {
      const calls = Promise.all([auth().getToken(), auth().getToken(), auth().getToken()]);
      fake.handlers.expired.forEach((h) => h());
      await vi.waitFor(() => expect(fake.signinSilent).toHaveBeenCalled());
      finish();
      tokens = await calls;
    });
    await pending;

    expect(fake.signinSilent).toHaveBeenCalledTimes(1);
    expect(tokens).toEqual(["new", "new", "new"]);
    expect(screen.getByTestId("status")).toHaveTextContent("signed-in");

    // A later expiry starts a fresh renewal: the in-flight promise was cleared.
    fake.user = { expired: true, access_token: "new", profile: { sub: "u1" } };
    fake.signinSilent.mockResolvedValue({ expired: false, access_token: "newer", profile: { sub: "u1" } });
    await expect(auth().getToken()).resolves.toBe("newer");
    expect(fake.signinSilent).toHaveBeenCalledTimes(2);
  });

  test("ACC-014: getToken when signed out returns null without trying to renew", async () => {
    fake.user = null;
    const { auth } = await setup();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-out"));
    await expect(auth().getToken()).resolves.toBeNull();
    expect(fake.signinSilent).not.toHaveBeenCalled();
  });
});
