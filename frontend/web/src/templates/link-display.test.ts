import { Globe, Link as LinkIcon } from "lucide-react";
import { describe, expect, test } from "vitest";
import { sampleLabels } from "./fixtures";
import {
  FacebookIcon,
  InstagramIcon,
  LinkedInIcon,
  TikTokIcon,
  XIcon,
  YouTubeIcon,
} from "./icons";
import {
  initials,
  linkAddress,
  linkAriaLabel,
  linkIcon,
  linkName,
  splitLinksForIcons,
} from "./link-display";

const labels = sampleLabels;

describe("link display", () => {
  test("PUB-035 a link's address drops the scheme, www. and the trailing slash", () => {
    expect(linkAddress("https://www.linkedin.com/in/alice/")).toBe("linkedin.com/in/alice");
    expect(linkAddress("http://alice.example.test")).toBe("alice.example.test");
    expect(linkAddress("https://alice.example.test/a//")).toBe("alice.example.test/a/");
  });

  test("PUB-035 icons and rows: free-form links become rows, the order and indexes stay", () => {
    const links = [
      { kind: "linkedin", url: "https://a.test" },
      { kind: "custom", url: "https://b.test", label: "Portfolio" },
      { kind: "website", url: "https://c.test" },
      { kind: "custom", url: "https://d.test" },
    ] as never[];
    const { icons, rows } = splitLinksForIcons(links);
    expect(icons.map((i) => i.index)).toEqual([0, 2]);
    expect(rows.map((r) => r.index)).toEqual([1, 3]);
    expect(rows[0]?.link).toBe(links[1]);
  });

  test("PUB-035 the accessible name is name — address", () => {
    expect(
      linkAriaLabel(labels, { kind: "linkedin", url: "https://www.linkedin.com/in/alice/" } as never),
    ).toBe("LinkedIn — linkedin.com/in/alice");
    expect(
      linkAriaLabel(labels, {
        kind: "custom",
        url: "https://alice.example.test/",
        label: "Portfolio",
      } as never),
    ).toBe("Portfolio — alice.example.test");
  });

  test("PUB-035 the name is the label, else the kind name, else website (TPL-016)", () => {
    expect(linkName(labels, { kind: "x", url: "https://x.com/a", label: "Mon X" } as never)).toBe(
      "Mon X",
    );
    expect(linkName(labels, { kind: "x", url: "https://x.com/a" } as never)).toBe("X");
    expect(linkName(labels, { kind: "mastodon", url: "https://m.test" } as never)).toBe("Site web");
  });

  test("PUB-036 every brand has its own icon, a website a globe, a free link a chain", () => {
    expect(linkIcon("linkedin")).toBe(LinkedInIcon);
    expect(linkIcon("instagram")).toBe(InstagramIcon);
    expect(linkIcon("facebook")).toBe(FacebookIcon);
    expect(linkIcon("tiktok")).toBe(TikTokIcon);
    expect(linkIcon("youtube")).toBe(YouTubeIcon);
    expect(linkIcon("x")).toBe(XIcon);
    expect(linkIcon("website")).toBe(Globe);
    expect(linkIcon("custom")).toBe(LinkIcon);
    expect(linkIcon("mastodon")).toBe(Globe);
  });

  test("PUB-023 initials of the first and last name, uppercase, accents kept", () => {
    expect(initials("Éloïse", "D’Aubigné-Müller")).toBe("ÉD");
    expect(initials("Alice", null)).toBe("A");
    expect(initials("  zoé ", " lefèvre")).toBe("ZL");
    expect(initials(undefined, undefined)).toBe("");
  });
});
