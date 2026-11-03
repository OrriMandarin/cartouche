import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useAuth } from "../context";
import { TestAuthAdapter } from "./test";

const TOKEN_KEY = "cartouche.test.token";
const SUBJECT_KEY = "cartouche.test.subject";

function Probe({ subject = "seed-alice" }: { subject?: string }) {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="subject">{auth.user?.subject ?? ""}</span>
      <span data-testid="email">{auth.user?.email ?? ""}</span>
      <span data-testid="name">{auth.user?.name ?? ""}</span>
      <button onClick={() => void auth.signIn({ subject })}>in</button>
      <button onClick={() => void auth.signOut()}>out</button>
      <button
        onClick={() => void auth.getToken().then((t) => document.body.setAttribute("data-token", String(t)))}
      >
        token
      </button>
    </div>
  );
}

function mockTokenEndpoint(token = "tok") {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  sessionStorage.clear();
  document.body.removeAttribute("data-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TestAuthAdapter", () => {
  test("ACC-015: signIn stores token from /api/test/token and exposes user", async () => {
    const fetchMock = mockTokenEndpoint("tok");
    render(
      <TestAuthAdapter>
        <Probe />
      </TestAuthAdapter>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-out"));

    fireEvent.click(screen.getByText("in"));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));
    expect(screen.getByTestId("subject")).toHaveTextContent("seed-alice");
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe("tok");
    expect(sessionStorage.getItem(SUBJECT_KEY)).toBe("seed-alice");

    fireEvent.click(screen.getByText("token"));
    await waitFor(() => expect(document.body.getAttribute("data-token")).toBe("tok"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/test/token");
    expect(init.method).toBe("POST");
    // seed-alice belongs to the base scenario: email and name are sent along.
    expect(JSON.parse(init.body as string)).toEqual({
      subject: "seed-alice",
      email: "alice@example.test",
      name: "Alice Durand",
    });
    expect(screen.getByTestId("email")).toHaveTextContent("alice@example.test");
    expect(screen.getByTestId("name")).toHaveTextContent("Alice Durand");
  });

  test("ACC-015: signIn with a free subject sends only the subject, trimmed and NFC-normalised", async () => {
    const fetchMock = mockTokenEndpoint();
    render(
      <TestAuthAdapter>
        <Probe subject={"  café-user "} />
      </TestAuthAdapter>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-out"));

    fireEvent.click(screen.getByText("in"));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ subject: "café-user" });
    expect(sessionStorage.getItem(SUBJECT_KEY)).toBe("café-user");
  });

  test("ACC-015: signIn failure leaves the session signed out and rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    let rejection: unknown;
    function Failing() {
      const auth = useAuth();
      return (
        <div>
          <span data-testid="status">{auth.status}</span>
          <button onClick={() => void auth.signIn({ subject: "x" }).catch((e: unknown) => (rejection = e))}>in</button>
        </div>
      );
    }
    render(
      <TestAuthAdapter>
        <Failing />
      </TestAuthAdapter>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-out"));
    fireEvent.click(screen.getByText("in"));
    await waitFor(() => expect(rejection).toBeInstanceOf(Error));
    expect(screen.getByTestId("status")).toHaveTextContent("signed-out");
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  test("ACC-010: signOut clears session storage", async () => {
    mockTokenEndpoint();
    render(
      <TestAuthAdapter>
        <Probe />
      </TestAuthAdapter>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-out"));
    fireEvent.click(screen.getByText("in"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));

    fireEvent.click(screen.getByText("out"));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-out"));
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(SUBJECT_KEY)).toBeNull();
    expect(screen.getByTestId("subject")).toHaveTextContent("");
  });

  test("ACC-014: restores session from sessionStorage on mount", async () => {
    sessionStorage.setItem(TOKEN_KEY, "stored-tok");
    sessionStorage.setItem(SUBJECT_KEY, "seed-bob");
    render(
      <TestAuthAdapter>
        <Probe />
      </TestAuthAdapter>,
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-in"));
    expect(screen.getByTestId("subject")).toHaveTextContent("seed-bob");
    expect(screen.getByTestId("name")).toHaveTextContent("Bob Martin");
    fireEvent.click(screen.getByText("token"));
    await waitFor(() => expect(document.body.getAttribute("data-token")).toBe("stored-tok"));
  });

  test("ACC-014: getToken is null when signed out", async () => {
    render(
      <TestAuthAdapter>
        <Probe />
      </TestAuthAdapter>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signed-out"));
    fireEvent.click(screen.getByText("token"));
    await waitFor(() => expect(document.body.getAttribute("data-token")).toBe("null"));
  });
});
