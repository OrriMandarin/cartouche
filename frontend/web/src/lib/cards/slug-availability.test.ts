import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useSlugAvailability } from "./slug-availability";

const get = vi.fn();
const api = { GET: get };
vi.mock("@/lib/api", () => ({ useApi: () => api }));

function answer(status: string, slug: string | null = null) {
  return Promise.resolve({ data: { status, slug } });
}

beforeEach(() => {
  get.mockReset();
});

describe("useSlugAvailability", () => {
  test("LNK-020 an empty slug is idle and asks nothing", async () => {
    const { result } = renderHook(() => useSlugAvailability(""));
    expect(result.current).toEqual({ status: "idle", normalized: null });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(get).not.toHaveBeenCalled();
  });

  test("LNK-020 waits 300 ms, then reports the server's verdict", async () => {
    get.mockReturnValue(answer("free", "alice-durand-2"));
    const { result } = renderHook(() => useSlugAvailability("Alice-Durand-2", "card-1"));
    expect(result.current.status).toBe("checking");
    expect(get).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current).toEqual({ status: "free", normalized: "alice-durand-2" }));
    expect(get).toHaveBeenCalledWith("/api/slugs/availability", {
      params: { query: { slug: "Alice-Durand-2", card_id: "card-1" } },
    });
  });

  test("LNK-020 only the last of several quick edits is checked", async () => {
    get.mockImplementation(() => answer("free", "abc"));
    const { rerender } = renderHook(({ slug }) => useSlugAvailability(slug), { initialProps: { slug: "ab" } });
    rerender({ slug: "abc" });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenCalledWith("/api/slugs/availability", { params: { query: { slug: "abc" } } });
  });

  test("LNK-020 a stale response is ignored", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    get.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    get.mockReturnValueOnce(answer("taken", "bob-martin"));
    const { result, rerender } = renderHook(({ slug }) => useSlugAvailability(slug), {
      initialProps: { slug: "bob-martin-x" },
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    rerender({ slug: "bob-martin" });
    await waitFor(() => expect(result.current.status).toBe("taken"));
    resolveFirst({ data: { status: "free", slug: "bob-martin-x" } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toEqual({ status: "taken", normalized: "bob-martin" });
  });
});
