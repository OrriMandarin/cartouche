import { describe, expect, test } from "vitest";
import { allowedTargets, type UserStatus } from "./moderation";

describe("allowedTargets", () => {
  test("ADM-003: allowed targets mirror server transitions", () => {
    const expected: Record<UserStatus, UserStatus[]> = {
      pending: ["approved", "rejected"],
      rejected: ["approved"],
      approved: ["suspended"],
      suspended: ["approved"],
    };
    for (const [from, targets] of Object.entries(expected) as [UserStatus, UserStatus[]][]) {
      expect(allowedTargets(from)).toEqual(targets);
    }
  });

  test("ADM-003: never allows staying in the same status", () => {
    for (const status of ["pending", "approved", "rejected", "suspended"] as const) {
      expect(allowedTargets(status)).not.toContain(status);
    }
  });
});
