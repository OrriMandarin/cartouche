import { describe, expect, test } from "vitest";
import { eventView } from "./event-view.fixture";
import { eventStateLine } from "./state";

const PARIS = "Europe/Paris";

describe("eventStateLine", () => {
  test("EDI-019 EVT-022 a running event says since when and until when, in the user's zone", () => {
    const event = eventView({ phase: "running", starts_at: "2027-03-15T08:00:00Z", ends_at: "2027-03-15T16:00:00Z" });
    expect(eventStateLine(event, PARIS)).toEqual({
      key: "running",
      values: { start: "15 mars 2027 à 09:00", end: "15 mars 2027 à 17:00" },
    });
  });

  test("EDI-019 EVT-003 an event with no end says it is ended by hand", () => {
    const event = eventView({ phase: "running", starts_at: "2027-03-15T08:00:00Z", ends_at: null });
    expect(eventStateLine(event, PARIS)).toEqual({ key: "runningOpen", values: { start: "15 mars 2027 à 09:00" } });
    expect(eventStateLine({ ...event, phase: "upcoming" }, PARIS).key).toBe("upcomingOpen");
  });

  test("EDI-019 upcoming and past events read in their own tense", () => {
    const dates = { starts_at: "2027-03-15T08:00:00Z", ends_at: "2027-03-15T16:00:00Z" };
    expect(eventStateLine(eventView({ phase: "upcoming", ...dates }), PARIS).key).toBe("upcoming");
    expect(eventStateLine(eventView({ phase: "past", ...dates }), PARIS).key).toBe("past");
  });
});
