import { render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { resolveTheme } from "@/lib/theme/resolve";
import { TEMPLATE_TEST_IDS as IDS, type LinkKind, type PublicCard, type PublicEvent } from "./contract";
import { sampleCard, sampleEvents, sampleLabels, sampleUrls, sampleVideoHeader } from "./fixtures";
import { listTemplates, renderTemplate, type AnyTemplate } from "./registry";

function element(
  template: AnyTemplate,
  overrides: { card?: Partial<PublicCard>; events?: PublicEvent[]; theme?: unknown } = {},
) {
  return renderTemplate({
    template: template.id,
    settings: {},
    theme: overrides.theme ?? { preset: "clair" },
    card: { ...sampleCard, ...overrides.card },
    events: overrides.events ?? [],
    urls: sampleUrls,
    labels: sampleLabels,
    mode: "public",
  });
}

describe.each(listTemplates())("template $id", (template) => {
  test("TPL-002 TPL-014 renders on the server and in the browser", () => {
    const withEvents = element(template, { events: sampleEvents });
    expect(() => renderToString(withEvents)).not.toThrow();
    expect(() => render(withEvents)).not.toThrow();
    expect(() => renderToString(element(template, { card: { header: null, avatar: null } }))).not.toThrow();
  });

  test("PUB-011 PUB-003 shows the card information", () => {
    render(element(template));
    expect(screen.getByTestId(IDS.name)).toHaveTextContent("Éloïse D'Aubigné-Müller");
    expect(screen.getByTestId(IDS.jobTitle)).toHaveTextContent("Cheffe de projet numérique");
    expect(screen.getByTestId(IDS.company)).toHaveTextContent("Atelier Müller & Fils");
    expect(screen.getByTestId(IDS.description)).toHaveTextContent("Je conçois des services publics lisibles ✨");
    expect(screen.getByTestId(IDS.description)).toHaveTextContent("Bienvenue !");
  });

  test("PUB-021 email and phone open the native apps", () => {
    render(element(template));
    expect(screen.getByTestId(IDS.email)).toHaveAttribute("href", "mailto:eloise@example.com");
    expect(screen.getByTestId(IDS.phone)).toHaveAttribute("href", "tel:+33612345678");
    expect(screen.getByTestId(IDS.phone)).toHaveTextContent("+33 6 12 34 56 78");
  });

  test("PUB-021 an address with reserved characters cannot add mail fields", () => {
    const content = { ...sampleCard.content, email: "a?cc=x@example.com" };
    render(element(template, { card: { content } }));
    expect(screen.getByTestId(IDS.email)).toHaveAttribute("href", "mailto:a%3Fcc=x@example.com");
  });

  test("PUB-012 PUB-013 links keep their exact url and order", () => {
    render(element(template));
    sampleCard.links.forEach((link, index) => {
      const anchor = screen.getByTestId(IDS.link(index));
      expect(anchor).toHaveAttribute("href", link.url);
      expect(anchor.tagName).toBe("A");
      expect(anchor.parentElement?.closest("a")).toBeNull();
    });
    expect(screen.getByTestId(IDS.link(2))).toHaveTextContent("Mon podcast ✨");
    expect(screen.getByTestId(IDS.link(1))).toHaveTextContent("LinkedIn");
    expect(screen.queryByTestId(IDS.link(3))).toBeNull();
  });

  test("PUB-022 TPL-016 a stored link that is not http(s) renders no anchor", () => {
    const links = [
      { kind: "website" as const, url: "javascript:alert(1)" },
      { kind: "custom" as const, url: "data:text/html,x", label: "Piège" },
      { kind: "linkedin" as const, url: "https://www.linkedin.com/in/eloise" },
    ];
    const { container } = render(element(template, { card: { links } }));
    const hrefs = [...container.querySelectorAll("a")].map((anchor) => anchor.getAttribute("href") ?? "");
    expect(hrefs.filter((href) => /^(javascript|data):/i.test(href))).toEqual([]);
    expect(screen.queryByText("Piège")).toBeNull();
    expect(screen.getByText("LinkedIn")).toBeInTheDocument();
  });

  test("PUB-022 TPL-016 a card whose links are all unsafe shows no empty link list", () => {
    const links = [{ kind: "website" as const, url: "javascript:alert(1)" }];
    const { container } = render(element(template, { card: { links } }));
    expect(container.querySelector("ul")).toBeNull();
  });

  test("TPL-016 an unknown link kind falls back to the website icon and label", () => {
    const links = [{ kind: "mastodon" as LinkKind, url: "https://social.example/@eloise" }];
    const { container } = render(element(template, { card: { links } }));
    const anchor = screen.getByTestId(IDS.link(0));
    expect(anchor).toHaveAttribute("href", "https://social.example/@eloise");
    expect(anchor).toHaveTextContent(sampleLabels.links.website);
    expect(anchor.querySelector("svg")).not.toBeNull();
    expect(container.querySelectorAll("a[href^='https://social.example']")).toHaveLength(1);
  });

  test("PUB-014 save contact points to the vCard url", () => {
    render(element(template));
    const button = screen.getByTestId(IDS.saveContact);
    expect(button).toHaveAttribute("href", sampleUrls.vcard);
    expect(button).toHaveAttribute("download");
    expect(button).toHaveTextContent(sampleLabels.saveContact);
  });

  test("PUB-004 header image is full width and responsive", () => {
    render(element(template));
    const image = screen.getByTestId(IDS.headerImage);
    expect(image.tagName).toBe("IMG");
    // The card is at most 28rem wide (max-w-md): a wide screen must not pick a larger file than that.
    expect(image).toHaveAttribute("sizes", "(min-width: 28rem) 28rem, 100vw");
    expect(image.getAttribute("srcset")).toContain("w1920.webp 1920w");
    expect(screen.queryByTestId(IDS.headerVideo)).toBeNull();
  });

  test("PUB-004 PUB-005 PUB-006 header video is muted, looping, inline, with poster", () => {
    const html = renderToString(element(template, { card: { header: sampleVideoHeader } }));
    for (const attribute of ["autoplay", "loop", "muted", "playsinline"]) {
      expect(html.toLowerCase()).toMatch(new RegExp(`<video[^>]* ${attribute}(=|\\s|>)`));
    }

    render(element(template, { card: { header: sampleVideoHeader } }));
    const video = screen.getByTestId(IDS.headerVideo) as HTMLVideoElement;
    expect(video.tagName).toBe("VIDEO");
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveAttribute("src", sampleVideoHeader.video_url);
    expect(video).toHaveAttribute("poster", "https://media.example.test/cards/c1/v1/w1080.webp");
    expect(screen.queryByTestId(IDS.headerImage)).toBeNull();
  });

  test("PUB-007 avatar sits on the header gradient", () => {
    const { container } = render(element(template, { theme: { preset: "clair", header_gradient: 70 } }));
    expect(screen.getByTestId(IDS.avatar)).toBeInTheDocument();
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--card-header-gradient")).toBe("0.7");
  });

  test("PUB-008 PUB-009 event buttons are sorted by start", () => {
    render(element(template, { events: sampleEvents }));
    const buttons = screen.getAllByTestId(/^event-button-/);
    expect(buttons.map((button) => button.getAttribute("data-testid"))).toEqual([
      IDS.eventButton("evt-atelier"),
      IDS.eventButton("evt-salon"),
    ]);
    expect(buttons[0]).toHaveAttribute("href", sampleUrls.eventForm("evt-atelier"));
    expect(buttons[1]).toHaveAttribute("href", sampleUrls.eventForm("evt-salon"));
    expect(buttons[1]).toHaveTextContent("Salon de l'innovation ✨");
  });

  test("PUB-010 no event, no button area", () => {
    const { container } = render(element(template, { events: [] }));
    expect(screen.queryAllByTestId(/^event-button-/)).toHaveLength(0);
    expect(container.querySelectorAll("div:empty:not([aria-hidden]), ul:empty")).toHaveLength(0);
  });

  test("PUB-023 empty elements are not rendered", () => {
    const content = { first_name: "Éloïse" };
    const { container } = render(
      element(template, { card: { avatar: null, header: null, links: [], content: content as PublicCard["content"] } }),
    );
    for (const id of [IDS.avatar, IDS.email, IDS.phone, IDS.headerImage, IDS.headerVideo, IDS.jobTitle, IDS.company, IDS.description]) {
      expect(screen.queryByTestId(id), id).toBeNull();
    }
    expect(screen.queryByTestId(IDS.link(0))).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
    expect(screen.getByTestId(IDS.name)).toHaveTextContent("Éloïse");
  });

  test("TPL-003 required test ids are present", () => {
    render(element(template, { events: sampleEvents }));
    for (const id of Object.values(IDS)) {
      if (typeof id !== "string" || id === IDS.headerVideo) continue;
      expect(screen.getByTestId(id), id).toBeInTheDocument();
    }
    expect(within(document.body).getByTestId(IDS.link(0))).toBeInTheDocument();
    expect(screen.getByTestId(IDS.eventButton("evt-salon"))).toBeInTheDocument();
  });

  test("TPL-003 the video header test id is set when the header is a video", () => {
    render(element(template, { card: { header: sampleVideoHeader } }));
    expect(screen.getByTestId(IDS.headerVideo)).toBeInTheDocument();
  });

  test("TPL-019 the theme reaches the template as CSS variables only", () => {
    const { container } = render(element(template, { theme: { preset: "sombre" } }));
    const root = container.firstElementChild as HTMLElement;
    const theme = resolveTheme({ preset: "sombre" });
    expect(root.style.getPropertyValue("--card-accent")).toBe(theme.accent);
    expect(root.style.getPropertyValue("--card-text")).toBe(theme.text);
  });
});
