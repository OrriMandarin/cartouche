import { ApiError } from "@cartouche/api-client";
import { describe, expect, test } from "vitest";
import { eventErrorKey } from "./errors";

function error(status: number, code: string) {
  return new ApiError({ status, code, message: "x", requestId: "r" });
}

describe("eventErrorKey", () => {
  test("EVT-018 EVT-021 the refusals an owner can act on have their own message", () => {
    expect(eventErrorKey(error(409, "too_many_simultaneous_events"))).toBe("events.errors.too_many_simultaneous_events");
    expect(eventErrorKey(error(409, "event_not_running"))).toBe("events.errors.event_not_running");
  });

  test("EVT-018 any other failure has none", () => {
    expect(eventErrorKey(error(500, "internal_error"))).toBeNull();
    expect(eventErrorKey(error(404, "not_found"))).toBeNull();
    expect(eventErrorKey(new Error("boom"))).toBeNull();
    expect(eventErrorKey(undefined)).toBeNull();
  });
});
