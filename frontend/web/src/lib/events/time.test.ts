import { afterEach, describe, expect, test, vi } from "vitest";
import { formatEventDate, fromLocalInput, toLocalInput, userTimeZone, zoneLabel } from "./time";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("time", () => {
  test("EVT-007 EVT-022 local input round trip in the user's zone", () => {
    expect(fromLocalInput("2027-03-15T11:00", "Europe/Paris")).toBe("2027-03-15T10:00:00.000Z");
    expect(toLocalInput("2027-03-15T10:00:00Z", "Europe/Paris")).toBe("2027-03-15T11:00");
    // Summer time: UTC+2.
    expect(fromLocalInput("2027-04-02T10:00", "Europe/Paris")).toBe("2027-04-02T08:00:00.000Z");
    expect(toLocalInput("2027-04-02T08:00:00Z", "Europe/Paris")).toBe("2027-04-02T10:00");
    // Another zone, standard time then daylight time (UTC-5, then UTC-4).
    expect(fromLocalInput("2027-01-15T09:00", "America/New_York")).toBe("2027-01-15T14:00:00.000Z");
    expect(fromLocalInput("2027-07-15T09:00", "America/New_York")).toBe("2027-07-15T13:00:00.000Z");
    expect(toLocalInput("2027-07-15T13:00:00Z", "America/New_York")).toBe("2027-07-15T09:00");
    // A zone with a half-hour offset.
    expect(fromLocalInput("2027-03-15T11:00", "Asia/Kolkata")).toBe("2027-03-15T05:30:00.000Z");
  });

  test("EVT-007 a value with seconds is read like the one without", () => {
    expect(fromLocalInput("2027-03-15T11:00:30", "Europe/Paris")).toBe("2027-03-15T10:00:30.000Z");
  });

  test("EVT-007 a malformed local value is refused", () => {
    expect(() => fromLocalInput("", "Europe/Paris")).toThrow(RangeError);
    expect(() => fromLocalInput("15/03/2027 11:00", "Europe/Paris")).toThrow(RangeError);
  });

  test("EVT-022 the zone is the browser's", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      () => ({ resolvedOptions: () => ({ timeZone: "America/New_York" }) }) as Intl.DateTimeFormat,
    );
    expect(userTimeZone()).toBe("America/New_York");
  });

  test("EVT-022 the zone falls back to Europe/Paris", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      () => ({ resolvedOptions: () => ({ timeZone: undefined }) }) as unknown as Intl.DateTimeFormat,
    );
    expect(userTimeZone()).toBe("Europe/Paris");
  });

  test("EVT-023 a local time that does not exist moves forward one hour", () => {
    // 2027-03-28: Paris goes from 02:00 to 03:00; 02:30 becomes 03:30 (CEST) = 01:30 UTC.
    expect(fromLocalInput("2027-03-28T02:30", "Europe/Paris")).toBe("2027-03-28T01:30:00.000Z");
    expect(fromLocalInput("2027-03-14T02:30", "America/New_York")).toBe("2027-03-14T07:30:00.000Z");
  });

  test("EVT-023 an ambiguous local time is the first occurrence", () => {
    // 2027-10-31: Paris goes from 03:00 back to 02:00; 02:30 is first CEST (00:30 UTC).
    expect(fromLocalInput("2027-10-31T02:30", "Europe/Paris")).toBe("2027-10-31T00:30:00.000Z");
  });

  test("EVT-023 times around a change are left alone", () => {
    expect(fromLocalInput("2027-03-28T01:59", "Europe/Paris")).toBe("2027-03-28T00:59:00.000Z");
    expect(fromLocalInput("2027-03-28T03:00", "Europe/Paris")).toBe("2027-03-28T01:00:00.000Z");
    expect(fromLocalInput("2027-10-31T01:59", "Europe/Paris")).toBe("2027-10-30T23:59:00.000Z");
    expect(fromLocalInput("2027-10-31T03:00", "Europe/Paris")).toBe("2027-10-31T02:00:00.000Z");
  });

  test("EVT-007 dates are shown in French, in the user's zone", () => {
    expect(formatEventDate("2027-03-15T10:00:00Z", "Europe/Paris")).toBe("15 mars 2027 à 11:00");
    expect(formatEventDate("2027-03-15T10:00:00Z", "America/New_York")).toBe("15 mars 2027 à 06:00");
  });

  test("EVT-022 the zone has a readable name", () => {
    expect(zoneLabel("Europe/Paris")).toBe("Europe/Paris");
    expect(zoneLabel("America/New_York")).toBe("America/New York");
  });
});
