import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useSlugSuggestion } from "./slug-suggestion";

const get = vi.fn();
const api = { GET: get };
vi.mock("@/lib/api", () => ({ useApi: () => api }));

beforeEach(() => {
  get.mockReset();
});

describe("useSlugSuggestion", () => {
  test("LNK-019 suggests a slug from the name", async () => {
    get.mockResolvedValue({ data: { slug: "alice-durand-2" } });
    const { result } = renderHook(() => useSlugSuggestion("Alice", "Durand"));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe("alice-durand-2"));
    expect(get).toHaveBeenCalledWith("/api/slugs/suggestion", {
      params: { query: { first_name: "Alice", last_name: "Durand" } },
    });
  });

  test("LNK-019 asks nothing while both names are empty", async () => {
    const { result } = renderHook(() => useSlugSuggestion(" ", ""));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(get).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  test("LNK-019 no suggestion is null", async () => {
    get.mockResolvedValue({ data: { slug: null } });
    const { result } = renderHook(() => useSlugSuggestion("✨", ""));
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
