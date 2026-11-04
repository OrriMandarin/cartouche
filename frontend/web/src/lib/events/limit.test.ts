import { describe, expect, test } from "vitest";
import { eventView } from "./event-view.fixture";
import { runningLimitReached } from "./limit";

const running = (id: string) => eventView({ id, phase: "running" });

describe("runningLimitReached", () => {
  test("EDI-032 EVT-004 the limit is reached at the instance's maximum of events in progress", () => {
    const events = [running("a"), running("b"), eventView({ id: "c", phase: "upcoming" })];
    expect(runningLimitReached(events, 3)).toBe(false);
    expect(runningLimitReached(events, 2)).toBe(true);
    expect(runningLimitReached([...events, running("d")], 3)).toBe(true);
  });

  test("EDI-032 upcoming and past events do not count", () => {
    const events = [eventView({ phase: "upcoming" }), eventView({ id: "p", phase: "past" })];
    expect(runningLimitReached(events, 1)).toBe(false);
  });

  test("EDI-032 a card with no event never reaches the limit", () => {
    expect(runningLimitReached([], 3)).toBe(false);
  });
});
