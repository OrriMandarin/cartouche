import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { TEMPLATE_TEST_IDS as IDS } from "../contract";
import { sampleCard, sampleEvents, sampleLabels, sampleUrls } from "../fixtures";
import { renderTemplate } from "../registry";

function classique(settings: unknown, events = sampleEvents, card = sampleCard) {
  return renderTemplate({
    template: "classique",
    settings,
    theme: { preset: "craie", header_gradient: 55 },
    card,
    events,
    urls: sampleUrls,
    labels: sampleLabels,
    mode: "public",
  });
}

/** Position of each element in document order. */
function documentOrder(elements: Element[]): number[] {
  const all = [...document.querySelectorAll("*")];
  return elements.map((element) => all.indexOf(element));
}

afterEach(() => vi.restoreAllMocks());

describe("Classique", () => {
  test("PUB-030 the order is header, photo, events, identity, save, contacts, links", () => {
    render(classique({}));
    const ordered = [
      screen.getByTestId(IDS.headerImage),
      screen.getByTestId(IDS.avatar),
      screen.getByTestId(IDS.eventButton("evt-atelier")),
      screen.getByTestId(IDS.eventButton("evt-salon")),
      screen.getByTestId(IDS.name),
      screen.getByTestId(IDS.jobTitle),
      screen.getByTestId(IDS.company),
      screen.getByTestId(IDS.description),
      screen.getByTestId(IDS.saveContact),
      screen.getByTestId(IDS.email),
      screen.getByTestId(IDS.phone),
      screen.getByTestId(IDS.link(0)),
      screen.getByTestId(IDS.link(1)),
      screen.getByTestId(IDS.link(2)),
    ];
    const positions = documentOrder(ordered);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions).not.toContain(-1);
  });

  test("PUB-023 without photo the initials show on the accent, without header a short band", () => {
    render(classique({}, [], { ...sampleCard, avatar: null, header: null }));
    const initials = screen.getByTestId(IDS.initials);
    expect(initials).toHaveTextContent(/^ÉD$/);
    expect(initials).toHaveClass("cc-avatar", "is-initials");
    expect(initials).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByTestId(IDS.avatar)).toBeNull();
    const band = screen.getByTestId(IDS.headerEmpty);
    expect(band).toHaveClass("cc-media", "is-empty");
    expect(band).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByTestId(IDS.headerImage)).toBeNull();
  });

  test("PUB-008 an event button carries the live label, the name and a chevron", () => {
    render(classique({}));
    const button = screen.getByTestId(IDS.eventButton("evt-salon"));
    expect(button).toHaveClass("cc-event");
    expect(button).toHaveAttribute("href", sampleUrls.eventForm("evt-salon"));
    expect(button.querySelector(".cc-event-live")).toHaveTextContent(sampleLabels.eventLive);
    expect(button.querySelector(".cc-event-live .cc-dot")).toHaveAttribute("aria-hidden", "true");
    expect(within(button).getByTestId(IDS.eventName)).toHaveTextContent("Salon de l'innovation ✨");
    expect(button.querySelector(":scope > svg")).not.toBeNull();
  });

  test("PUB-010 no event, no event area", () => {
    const { container } = render(classique({}, []));
    expect(container.querySelector(".cc-events")).toBeNull();
    expect(screen.queryAllByTestId(/^event-button-/)).toHaveLength(0);
  });

  test("PUB-034 email and phone rows carry their sub-label", () => {
    render(classique({}));
    const contacts = screen.getByRole("list", { name: sampleLabels.contacts });
    const email = within(contacts).getByTestId(IDS.email);
    expect(email).toHaveClass("cc-row");
    expect(email.querySelector(".cc-row-label")).toHaveTextContent("eloise@example.com");
    expect(email.querySelector(".cc-row-sub")).toHaveTextContent(sampleLabels.emailLabel);
    const phone = within(contacts).getByTestId(IDS.phone);
    expect(phone.querySelector(".cc-row-label")).toHaveTextContent("+33 6 12 34 56 78");
    expect(phone.querySelector(".cc-row-sub")).toHaveTextContent(sampleLabels.phoneLabel);
  });

  test("PUB-035 TPL-027 icons by default, free links as rows under them", () => {
    render(classique({}));
    const icons = screen.getByRole("list", { name: sampleLabels.networks });
    const linkedin = within(icons).getByTestId(IDS.link(1));
    expect(linkedin).toHaveClass("cc-icon");
    expect(linkedin).toHaveAttribute("aria-label", "LinkedIn — linkedin.com/in/eloise-daubigne-muller");
    expect(linkedin.textContent).toBe("");
    expect(linkedin).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(icons).getByTestId(IDS.link(0))).toHaveAttribute(
      "aria-label",
      "Site web — eloise-daubigne.example/portfolio?ref=carte&lang=fr",
    );

    const rows = screen.getByRole("list", { name: sampleLabels.linksList });
    const podcast = within(rows).getByTestId(IDS.link(2));
    expect(podcast).toHaveClass("cc-row");
    expect(podcast.querySelector(".cc-row-label")).toHaveTextContent("Mon podcast ✨");
    expect(podcast.querySelector(".cc-row-sub")).toHaveTextContent("podcast.example/épisodes?x=1#top");
    // The rows list sits under the icons, in the same set.
    expect(rows.parentElement).toBe(icons.parentElement);
    expect(icons.parentElement).toHaveClass("cc-iconset");
  });

  test("PUB-035 the list layout shows every link as a row", () => {
    render(classique({ links_layout: "list" }));
    expect(screen.queryByRole("list", { name: sampleLabels.networks })).toBeNull();
    const rows = screen.getByRole("list", { name: sampleLabels.linksList });
    sampleCard.links.forEach((_, index) => {
      const anchor = within(rows).getByTestId(IDS.link(index));
      expect(anchor).toHaveClass("cc-row");
      expect(anchor.querySelector(".cc-row-end")).not.toBeNull();
    });
    const linkedin = screen.getByTestId(IDS.link(1));
    expect(linkedin.querySelector(".cc-row-label")).toHaveTextContent("LinkedIn");
    expect(linkedin.querySelector(".cc-row-sub")).toHaveTextContent("linkedin.com/in/eloise-daubigne-muller");
    expect(linkedin).not.toHaveAttribute("aria-label");
  });

  test("TPL-016 TPL-027 a stored animate_events setting is ignored", () => {
    render(classique({ animate_events: false }));
    const button = screen.getByTestId(IDS.eventButton("evt-salon"));
    expect(button.className).toBe("cc-event");
    expect(screen.getByRole("list", { name: sampleLabels.networks })).toBeInTheDocument();
  });

  test("TPL-026 the theme variables sit on the card element", () => {
    const { container } = render(classique({}));
    const article = container.querySelector("article")!;
    expect(article).toHaveClass("cc");
    expect(article.style.getPropertyValue("--c-accent")).not.toBe("");
    expect(article.style.getPropertyValue("--fade")).toBe("55");
    expect(article).toHaveAttribute("data-shape", "rounded");
    expect(document.documentElement.style.getPropertyValue("--c-accent")).toBe("");
  });

  test("PUB-003 the avatar is named after the person and prefers the JPEG fallback", () => {
    render(classique({}));
    const avatar = screen.getByTestId(IDS.avatar);
    expect(avatar.parentElement).toHaveClass("cc-avatar");
    expect(avatar).toHaveAttribute("alt", "Éloïse D'Aubigné-Müller");
    expect(avatar).toHaveAttribute("src", sampleCard.avatar?.jpeg_url);
    expect(avatar.getAttribute("srcset")).toContain("s256.webp 256w");
  });

  describe("profile photo loader", () => {
    function mockImage(complete: boolean, naturalWidth: number) {
      vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(complete);
      vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(naturalWidth);
    }
    const circle = () => screen.getByTestId(IDS.avatar).parentElement!;

    test("PUB-040 the profile photo shows the sheen in its circle until it loads", () => {
      mockImage(false, 0);
      render(classique({}));
      expect(circle()).toHaveAttribute("aria-busy", "true");
      expect(circle()).toHaveClass("is-loading");
      expect(circle().querySelector(".cc-shimmer")).not.toBeNull();
      fireEvent.load(screen.getByTestId(IDS.avatar));
      expect(circle()).toHaveAttribute("aria-busy", "false");
      expect(circle().querySelector(".cc-shimmer")).toBeNull();
    });

    test("PUB-040 a profile photo that cannot load keeps the surface in its circle", () => {
      mockImage(false, 0);
      render(classique({}));
      fireEvent.error(screen.getByTestId(IDS.avatar));
      expect(circle()).toHaveAttribute("aria-busy", "false");
      expect(circle()).toHaveClass("is-failed");
      expect(circle().querySelector(".cc-shimmer")).toBeNull();
    });

    test("PUB-041 a profile photo already loaded at mount is not shown as loading", () => {
      mockImage(true, 224);
      render(classique({}));
      expect(circle()).toHaveAttribute("aria-busy", "false");
      expect(circle().querySelector(".cc-shimmer")).toBeNull();
    });
  });

  test("PUB-038 the loading sheen does not move under reduced motion", () => {
    const css = readFileSync(join(__dirname, "classique.css"), "utf8");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.cc-shimmer\s*\{[^}]*animation:\s*none/);
  });

  test("PUB-006 PUB-038 the placeholder is not blurred under reduced motion, even before the page is interactive", () => {
    const css = readFileSync(join(__dirname, "classique.css"), "utf8");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.cc-media \.is-blur\s*\{[^}]*filter:\s*none[^}]*transform:\s*none/);
  });
});
