import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { TEMPLATE_TEST_IDS as IDS } from "../contract";
import { sampleCard, sampleEvents, sampleLabels, sampleUrls } from "../fixtures";
import { renderTemplate } from "../registry";

function classique(settings: unknown, events = sampleEvents, card = sampleCard) {
  return renderTemplate({
    template: "classique",
    settings,
    theme: { preset: "clair", header_gradient: 55 },
    card,
    events,
    urls: sampleUrls,
    labels: sampleLabels,
    mode: "public",
  });
}

describe("Classique", () => {
  test("TPL-004 links_layout list shows the label of every link", () => {
    render(classique({ links_layout: "list" }));
    expect(screen.getByTestId(IDS.link(0))).toHaveTextContent("Site web");
    expect(screen.getByTestId(IDS.link(0))).not.toHaveAttribute("aria-label");
  });

  test("TPL-004 links_layout icons shows icon-only links", () => {
    render(classique({ links_layout: "icons" }));
    sampleCard.links.forEach((link, index) => {
      const anchor = screen.getByTestId(IDS.link(index));
      expect(anchor).toHaveAttribute("aria-label", link.label ?? sampleLabels.links[link.kind]);
      expect(anchor.textContent).toBe("");
      expect(anchor.querySelector("svg")).not.toBeNull();
      expect(anchor).toHaveAttribute("href", link.url);
    });
  });

  test("TPL-004 animate_events toggles the event animation", () => {
    const { unmount } = render(classique({ animate_events: true }));
    expect(screen.getByTestId(IDS.eventButton("evt-salon")).className).toContain("animate-pulse");
    unmount();
    render(classique({ animate_events: false }));
    expect(screen.getByTestId(IDS.eventButton("evt-salon")).className).not.toContain("animate-pulse");
  });

  test("PUB-007 the gradient opacity follows the theme intensity", () => {
    render(classique({}));
    expect(screen.getByTestId("card-header-gradient").style.opacity).toBe("var(--card-header-gradient)");
  });

  test("PUB-023 no media means no gradient and the theme background", () => {
    render(classique({}, [], { ...sampleCard, header: null, avatar: null }));
    expect(screen.queryByTestId("card-header-gradient")).toBeNull();
  });

  test("PUB-003 the avatar is named after the person and prefers the JPEG fallback", () => {
    render(classique({}));
    const avatar = screen.getByTestId(IDS.avatar);
    expect(avatar).toHaveAttribute("alt", "Éloïse D'Aubigné-Müller");
    expect(avatar).toHaveAttribute("src", sampleCard.avatar?.jpeg_url);
    expect(avatar.getAttribute("srcset")).toContain("s256.webp 256w");
  });
});
