import { describe, expect, test } from "vitest";
import { sampleCard } from "@/templates/fixtures";
import { buildCardUrls } from "./public-card";

describe("buildCardUrls", () => {
  test("PUB-014 the vCard url is the one the API gave", () => {
    expect(buildCardUrls(sampleCard).vcard).toBe(sampleCard.vcard_url);
  });

  test("PUB-008 the event form lives under the card page", () => {
    expect(buildCardUrls(sampleCard).eventForm("evt-salon")).toBe("/c/eloise-daubigne/e/evt-salon");
  });

  test("PUB-008 the slug and the event id are percent-encoded in the path", () => {
    const urls = buildCardUrls({ ...sampleCard, slug: "a/b?c" });
    expect(urls.eventForm("x/../y?z#w")).toBe("/c/a%2Fb%3Fc/e/x%2F..%2Fy%3Fz%23w");
  });
});
