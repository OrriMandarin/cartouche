import { describe, expect, test } from "vitest";
import { eventSummary } from "./summary";

describe("eventSummary", () => {
  test("EDI-023 the events summary leaves out the empty parts", () => {
    expect(eventSummary({ running: 1, upcoming: 1 })).toEqual([
      { key: "running", count: 1 },
      { key: "upcoming", count: 1 },
    ]);
    expect(eventSummary({ running: 0, upcoming: 2 })).toEqual([{ key: "upcoming", count: 2 }]);
    expect(eventSummary({ running: 3, upcoming: 0 })).toEqual([{ key: "running", count: 3 }]);
    expect(eventSummary({ running: 0, upcoming: 0 })).toEqual([]);
  });
});
