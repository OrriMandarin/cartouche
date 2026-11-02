import { describe, expect, test } from "vitest";
import { resolveBuildConfig } from "./build-profile";

// spec: ACC-008
describe("resolveBuildConfig", () => {
  test("defaults to production profile and clerk provider", () => {
    expect(resolveBuildConfig({})).toEqual({ profile: "production", authProvider: "clerk" });
  });

  test("unknown profile falls back to production", () => {
    expect(resolveBuildConfig({ profile: "staging" }).profile).toBe("production");
    expect(resolveBuildConfig({ profile: "" }).profile).toBe("production");
  });

  test("rejects test provider with production profile", () => {
    expect(() => resolveBuildConfig({ profile: "production", authProvider: "test" })).toThrow(
      /cannot be used with the production build profile/,
    );
  });

  test("rejects test provider when the profile is missing or unknown", () => {
    expect(() => resolveBuildConfig({ authProvider: "test" })).toThrow(
      /cannot be used with the production build profile/,
    );
    expect(() => resolveBuildConfig({ profile: "prod", authProvider: "test" })).toThrow(
      /cannot be used with the production build profile/,
    );
  });

  test("allows test provider with test and development profiles", () => {
    expect(resolveBuildConfig({ profile: "test", authProvider: "test" })).toEqual({
      profile: "test",
      authProvider: "test",
    });
    expect(resolveBuildConfig({ profile: "development", authProvider: "test" })).toEqual({
      profile: "development",
      authProvider: "test",
    });
  });

  test("accepts the oidc provider", () => {
    expect(resolveBuildConfig({ profile: "production", authProvider: "oidc" }).authProvider).toBe("oidc");
  });

  test("rejects unknown provider", () => {
    expect(() => resolveBuildConfig({ authProvider: "auth0" })).toThrow(/Unknown auth provider/);
  });
});
