import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fetchPublicEvent } from "./public-event";
import { publicEventForm } from "./event-form/form.fixture";

const EVENT = "0198d000-0000-7000-8000-000000000001";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CARTOUCHE_BUILD_PROFILE", "test");
  vi.stubEnv("API_INTERNAL_URL", "http://api:8080");
});

function stubFetch(response: Response) {
  const spy = vi.fn<(request: Request, init?: RequestInit) => Promise<Response>>(async () => response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

function error(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: code, request_id: "req-1" } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fetchPublicEvent", () => {
  test("FRM-024 FRM-002 the event is read from the API, never stored", async () => {
    const body = { state: "open", event: publicEventForm() };
    const spy = stubFetch(
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
    );
    await expect(fetchPublicEvent("eloise-daubigne", EVENT)).resolves.toEqual(body);
    const [request, init] = spy.mock.calls[0]!;
    expect(request.url.startsWith("http://api:8080/")).toBe(true);
    expect(new URL(request.url).pathname).toBe(`/api/public/cards/eloise-daubigne/events/${EVENT}`);
    expect(init).toEqual({ cache: "no-store" });
  });

  test("FRM-024 fetchPublicEvent maps 404 and 400 to null and 410 to inactive", async () => {
    stubFetch(error(404, "not_found"));
    await expect(fetchPublicEvent("eloise-daubigne", EVENT)).resolves.toBeNull();
    stubFetch(error(400, "invalid_request"));
    await expect(fetchPublicEvent("eloise-daubigne", "not-a-uuid")).resolves.toBeNull();
    stubFetch(error(410, "card_inactive"));
    await expect(fetchPublicEvent("eloise-daubigne", EVENT)).resolves.toEqual({ state: "inactive" });
  });

  test("FRM-024 any other failure is not hidden", async () => {
    stubFetch(error(500, "internal_error"));
    await expect(fetchPublicEvent("eloise-daubigne", EVENT)).rejects.toMatchObject({ status: 500 });
  });
});
