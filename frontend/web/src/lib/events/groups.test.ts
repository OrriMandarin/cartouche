import { describe, expect, test } from "vitest";
import { eventView } from "./event-view.fixture";
import { canEndNow, groupEvents } from "./groups";

describe("groupEvents", () => {
  test("EDI-009 EVT-020 events are grouped by their server phase", () => {
    const events = [
      eventView({ id: "past-old", phase: "past", starts_at: "2020-01-01T10:00:00Z" }),
      eventView({ id: "up-late", phase: "upcoming", starts_at: "2099-06-01T10:00:00Z" }),
      eventView({ id: "past-new", phase: "past", starts_at: "2021-01-01T10:00:00Z" }),
      eventView({ id: "run-late", phase: "running", starts_at: "2020-03-01T10:00:00Z" }),
      eventView({ id: "up-soon", phase: "upcoming", starts_at: "2099-01-01T10:00:00Z" }),
      // Its dates are long gone for the browser, yet the server says it is running.
      eventView({ id: "run-early", phase: "running", starts_at: "2020-02-01T10:00:00Z", ends_at: "2020-02-02T10:00:00Z" }),
    ];
    const groups = groupEvents(events);
    expect(groups.running.map((e) => e.id)).toEqual(["run-early", "run-late"]);
    expect(groups.upcoming.map((e) => e.id)).toEqual(["up-soon", "up-late"]);
    expect(groups.past.map((e) => e.id)).toEqual(["past-new", "past-old"]);
  });

  test("EDI-009 no event gives three empty groups", () => {
    expect(groupEvents([])).toEqual({ running: [], upcoming: [], past: [] });
  });
});

describe("canEndNow", () => {
  test("EVT-006 EVT-021 only a running event can be ended now", () => {
    expect(canEndNow(eventView({ phase: "running" }))).toBe(true);
    expect(canEndNow(eventView({ phase: "upcoming" }))).toBe(false);
    expect(canEndNow(eventView({ phase: "past" }))).toBe(false);
  });
});
