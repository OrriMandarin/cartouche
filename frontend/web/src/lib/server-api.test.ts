import { afterEach, describe, expect, test, vi } from "vitest";
import { serverApiBaseUrl } from "./server-api";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("serverApiBaseUrl", () => {
  test("PUB-002 the server reads the API at API_INTERNAL_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_CARTOUCHE_BUILD_PROFILE", "test");
    vi.stubEnv("API_INTERNAL_URL", "http://api:8080");
    expect(serverApiBaseUrl()).toBe("http://api:8080");
  });

  test("PUB-002 development and test fall back to the local API", () => {
    vi.stubEnv("API_INTERNAL_URL", "");
    for (const profile of ["development", "test"]) {
      vi.stubEnv("NEXT_PUBLIC_CARTOUCHE_BUILD_PROFILE", profile);
      expect(serverApiBaseUrl()).toBe("http://localhost:8080");
    }
  });

  test("PUB-002 production without API_INTERNAL_URL is an error, also when the profile is unknown", () => {
    vi.stubEnv("API_INTERNAL_URL", "");
    vi.stubEnv("NEXT_PUBLIC_CARTOUCHE_BUILD_PROFILE", "production");
    expect(() => serverApiBaseUrl()).toThrow(/API_INTERNAL_URL/);
    vi.stubEnv("NEXT_PUBLIC_CARTOUCHE_BUILD_PROFILE", "");
    expect(() => serverApiBaseUrl()).toThrow(/API_INTERNAL_URL/);
  });
});
