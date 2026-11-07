import { afterEach, describe, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config", () => {
  test("MED-002 the web proxy lets a 50 MB upload through and waits for its processing", async () => {
    vi.stubEnv("API_INTERNAL_URL", "http://api.test");
    const { default: nextConfig } = await import("../../next.config");
    // 50 MB video plus its form fields; a video upload waits for its transcode (MED-039) and its transfer.
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe("56mb");
    expect(nextConfig.experimental?.proxyTimeout).toBe(180_000);
  });
});
