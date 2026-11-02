import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException: (...args: unknown[]) => captureException(...args) }));

import { ApiError } from "@cartouche/api-client";
import { AuthContext } from "./auth/context";
import type { AuthContextValue } from "./auth/types";
import { useApi } from "./api";

function wrapperFor(getToken: AuthContextValue["getToken"]) {
  const value: AuthContextValue = {
    status: "signed-in",
    user: { subject: "seed-alice" },
    getToken,
    signIn: async () => undefined,
    signOut: async () => undefined,
  };
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  };
}

// The client uses same-origin relative URLs, which browsers resolve but Node's Request does not.
class RelativeRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(typeof input === "string" && input.startsWith("/") ? `http://localhost${input}` : input, init);
  }
}

beforeEach(() => {
  captureException.mockClear();
  vi.unstubAllGlobals();
  vi.stubGlobal("Request", RelativeRequest);
});

describe("useApi", () => {
  test("ACC-014: returns a memoised client that sends the session token", async () => {
    const fetchMock = vi.fn(async (request: Request) => {
      expect(request.headers.get("authorization")).toBe("Bearer tok");
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const getToken = async () => "tok";
    const { result, rerender } = renderHook(() => useApi(), { wrapper: wrapperFor(getToken) });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);

    await (result.current as unknown as { GET: (path: string) => Promise<unknown> }).GET("/api/me");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("ACC-014: captures ApiError in Sentry with the request_id tag and rethrows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "token_invalid", message: "nope", request_id: "req-42" } }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const { result } = renderHook(() => useApi(), { wrapper: wrapperFor(async () => null) });

    const call = (result.current as unknown as { GET: (path: string) => Promise<unknown> }).GET("/api/me");
    await expect(call).rejects.toBeInstanceOf(ApiError);

    expect(captureException).toHaveBeenCalledTimes(1);
    const [error, hint] = captureException.mock.calls[0] as [ApiError, { tags: Record<string, string> }];
    expect(error.status).toBe(401);
    expect(hint.tags).toEqual({ request_id: "req-42" });
  });

  test("ACC-014: does not report errors that are not ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("network down"))));
    const { result } = renderHook(() => useApi(), { wrapper: wrapperFor(async () => null) });

    await expect(
      (result.current as unknown as { GET: (path: string) => Promise<unknown> }).GET("/api/me"),
    ).rejects.toThrow("network down");
    expect(captureException).not.toHaveBeenCalled();
  });
});
