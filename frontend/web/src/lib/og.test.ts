import { describe, expect, test } from "vitest";
import { sampleCard } from "@/templates/fixtures";
import type { PublicCard } from "@/templates/contract";
import { buildCardMetadata, INACTIVE_METADATA } from "./og";

const alice: PublicCard = {
  ...sampleCard,
  slug: "alice-durand",
  public_url: "https://cartouche.example.test/c/alice-durand",
  content: {
    first_name: "Alice",
    last_name: "Durand",
    job_title: "Fondatrice",
    company: "Atelier Durand & Fils",
    description: null,
    email: null,
    phone: null,
    phone_display: null,
  },
};

describe("open graph", () => {
  test("PUB-017 PUB-028 open graph uses name, title, company and the 512 jpeg", () => {
    const metadata = buildCardMetadata(alice);
    expect(metadata.title).toBe("Alice Durand");
    expect(metadata.description).toBe("Fondatrice · Atelier Durand & Fils");
    expect(metadata.openGraph).toMatchObject({
      title: "Alice Durand",
      description: "Fondatrice · Atelier Durand & Fils",
      url: "https://cartouche.example.test/c/alice-durand",
      images: [alice.avatar?.jpeg_url],
    });
    expect(alice.avatar?.jpeg_url).toMatch(/^https:\/\//);
    expect(metadata.twitter).toMatchObject({ card: "summary" });
  });

  test("PUB-028 open graph without photo has no image", () => {
    const metadata = buildCardMetadata({ ...alice, avatar: null });
    expect(metadata.openGraph?.images).toBeUndefined();
    expect(metadata.title).toBe("Alice Durand");
  });

  test("PUB-028 the description keeps only what the card has", () => {
    const only = (patch: Partial<PublicCard["content"]>) =>
      buildCardMetadata({ ...alice, content: { ...alice.content, ...patch } }).description;
    expect(only({ company: null })).toBe("Fondatrice");
    expect(only({ job_title: null })).toBe("Atelier Durand & Fils");
    expect(only({ job_title: null, company: null })).toBeUndefined();
  });

  test("LNK-027 inactive metadata reveals nothing and asks not to index", () => {
    expect(INACTIVE_METADATA.robots).toEqual({ index: false, follow: false });
    expect(INACTIVE_METADATA.openGraph).toBeUndefined();
    expect(INACTIVE_METADATA.twitter).toBeUndefined();
    expect(INACTIVE_METADATA.description).toBeUndefined();
  });
});
