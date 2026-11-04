import { describe, expect, test } from "vitest";
import { clerkAppearance } from "./clerk-appearance";

describe("clerkAppearance", () => {
  test("ACC-010 the Clerk fields and buttons keep a 44 px touch target", () => {
    for (const key of ["formFieldInput", "formButtonPrimary", "socialButtonsBlockButton"] as const) {
      expect(clerkAppearance.elements[key].minHeight).toBe("44px");
    }
  });

  test("ACC-010 the Clerk widgets use the dashboard colors", () => {
    expect(clerkAppearance.variables.colorPrimary).toBe("#1C1B19");
    expect(clerkAppearance.variables.colorDanger).toBe("#B3261E");
  });
});
