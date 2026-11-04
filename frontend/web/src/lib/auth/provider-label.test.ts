import { describe, expect, test } from "vitest";
import { signInProviderLabel } from "./provider-label";

describe("signInProviderLabel", () => {
  test("ACC-019 names the identity provider the user signed in with", () => {
    expect(signInProviderLabel("google")).toBe("Google");
    expect(signInProviderLabel("oauth_microsoft")).toBe("Microsoft");
    expect(signInProviderLabel("apple")).toBe("Apple");
  });

  test("ACC-019 a provider that is unknown or absent has no label", () => {
    expect(signInProviderLabel("some-sso")).toBeNull();
    expect(signInProviderLabel(undefined)).toBeNull();
  });
});
