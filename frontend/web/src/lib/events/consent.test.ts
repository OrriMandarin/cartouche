import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { CONSENT_PREVIEW_DELAY_MS, cardHasEmail, useConsentPreview } from "./consent";

const post = vi.fn();
const api = { POST: post };
vi.mock("@/lib/api", () => ({ useApi: () => api }));

function preview(text: string) {
  return Promise.resolve({ data: { text } });
}

beforeEach(() => {
  post.mockReset();
});

describe("cardHasEmail", () => {
  test("FRM-029 a card has an email unless it is absent or blank", () => {
    expect(cardHasEmail({ email: "alice@example.test" })).toBe(true);
    expect(cardHasEmail({ email: null })).toBe(false);
    expect(cardHasEmail({})).toBe(false);
    expect(cardHasEmail({ email: "  " })).toBe(false);
  });
});

describe("useConsentPreview", () => {
  test("FRM-029 R-PF6 the text comes from the server, after a pause", async () => {
    post.mockReturnValue(preview("Texte pour « Salon »."));
    const { result } = renderHook(() => useConsentPreview("card-1", "Salon"));
    expect(result.current).toEqual({ text: null, failed: false });
    expect(post).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.text).toBe("Texte pour « Salon »."));
    expect(post).toHaveBeenCalledWith("/api/cards/{id}/consent-preview", {
      params: { path: { id: "card-1" } },
      body: { title: "Salon" },
    });
  });

  test("FRM-029 the text already known for a title is shown without asking again", async () => {
    const { result } = renderHook(() =>
      useConsentPreview("card-1", "Salon", { title: "Salon", text: "Texte connu." }),
    );
    expect(result.current.text).toBe("Texte connu.");
    await new Promise((resolve) => setTimeout(resolve, CONSENT_PREVIEW_DELAY_MS + 100));
    expect(post).not.toHaveBeenCalled();
  });

  test("FRM-029 a new title is asked once typing pauses, the last text staying meanwhile", async () => {
    post.mockImplementation((_path: string, { body }: { body: { title: string } }) => preview(`Texte « ${body.title} ».`));
    const { result, rerender } = renderHook(({ title }) => useConsentPreview("card-1", title, { title: "A", text: "Texte « A »." }), {
      initialProps: { title: "A" },
    });
    rerender({ title: "AB" });
    rerender({ title: "ABC" });
    expect(result.current.text).toBe("Texte « A ».");
    await waitFor(() => expect(result.current.text).toBe("Texte « ABC »."));
    expect(post).toHaveBeenCalledTimes(1);
  });

  test("FRM-029 an answer to an outdated title is ignored", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    post.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    post.mockReturnValueOnce(preview("Texte B."));
    const { result, rerender } = renderHook(({ title }) => useConsentPreview("card-1", title), {
      initialProps: { title: "A" },
    });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    rerender({ title: "B" });
    await waitFor(() => expect(result.current.text).toBe("Texte B."));
    await act(async () => resolveFirst({ data: { text: "Texte A." } }));
    expect(result.current.text).toBe("Texte B.");
  });

  test("FRM-029 a failed preview says so instead of staying silent", async () => {
    post.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useConsentPreview("card-1", "Salon"));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.text).toBeNull();
  });
});
