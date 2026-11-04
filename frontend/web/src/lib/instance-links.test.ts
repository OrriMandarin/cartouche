import { afterEach, describe, expect, test, vi } from "vitest";
import { privacyUrl, supportEmail, supportMailto, termsUrl } from "./instance-links";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("instance links", () => {
  test("ADM-021 contact points default to placeholders and follow the configuration", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", undefined);
    vi.stubEnv("NEXT_PUBLIC_TERMS_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_PRIVACY_URL", undefined);
    expect(supportEmail()).toBe("support@cartouche.invalid");
    expect(supportMailto()).toBe("mailto:support%40cartouche.invalid");
    expect(termsUrl()).toBe("/cgu");
    expect(privacyUrl()).toBe("/confidentialite");

    // An empty variable is no configuration.
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "");
    vi.stubEnv("NEXT_PUBLIC_TERMS_URL", "");
    vi.stubEnv("NEXT_PUBLIC_PRIVACY_URL", "");
    expect(supportEmail()).toBe("support@cartouche.invalid");
    expect(termsUrl()).toBe("/cgu");
    expect(privacyUrl()).toBe("/confidentialite");

    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "aide+carte@zoé.example");
    vi.stubEnv("NEXT_PUBLIC_TERMS_URL", "https://cartes.example/conditions");
    vi.stubEnv("NEXT_PUBLIC_PRIVACY_URL", "https://cartes.example/vie-privée");
    expect(supportEmail()).toBe("aide+carte@zoé.example");
    expect(supportMailto()).toBe("mailto:aide%2Bcarte%40zo%C3%A9.example");
    expect(termsUrl()).toBe("https://cartes.example/conditions");
    expect(privacyUrl()).toBe("https://cartes.example/vie-privée");
  });
});
