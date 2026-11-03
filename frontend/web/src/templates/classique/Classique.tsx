import { Download, Globe, Link as LinkIcon, Mail, Phone, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { themeStyle } from "@/lib/theme/resolve";
import { isHttpUrl, mailtoHref, telHref } from "../contact-links";
import {
  TEMPLATE_TEST_IDS as TEST_IDS,
  linkLabel,
  type LinkKind,
  type MediaView,
  type PublicEvent,
  type TemplateProps,
} from "../contract";
import type { ClassiqueSettings } from "./settings";

// The installed lucide-react has no brand icons: brands share the generic globe.
const LINK_ICONS: Record<LinkKind, LucideIcon> = {
  website: Globe,
  linkedin: Globe,
  instagram: Globe,
  facebook: Globe,
  tiktok: Globe,
  youtube: Globe,
  x: Globe,
  custom: LinkIcon,
};

const BUTTON_STYLE: CSSProperties = {
  borderRadius: "var(--card-radius)",
  border: "2px solid var(--card-accent)",
  background: "color-mix(in srgb, var(--card-accent) 14%, transparent)",
};

// Fades the header into the page background; the intensity is the theme's header gradient (PUB-007).
const GRADIENT_STYLE: CSSProperties = {
  background: "var(--card-bg)",
  opacity: "var(--card-header-gradient)",
  maskImage: "linear-gradient(to bottom, transparent, black)",
  WebkitMaskImage: "linear-gradient(to bottom, transparent, black)",
};

function srcSet(media: MediaView): string {
  return media.images.map((image) => `${image.url} ${image.width}w`).join(", ");
}

function largestImageUrl(media: MediaView): string | undefined {
  return media.images.at(-1)?.url;
}

function headerMedia(header: MediaView | null | undefined) {
  if (!header) return null;
  if (header.kind === "video" && header.video_url) {
    return (
      <video
        data-testid={TEST_IDS.headerVideo}
        className="h-full w-full object-cover"
        src={header.video_url}
        poster={largestImageUrl(header)}
        autoPlay
        muted
        loop
        playsInline
        aria-hidden="true"
      />
    );
  }
  const src = largestImageUrl(header);
  if (!src) return null;
  return (
    // A plain img: media URLs are absolute and external, and next/image would add an optimizer hop.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-testid={TEST_IDS.headerImage}
      className="h-full w-full object-cover"
      src={src}
      srcSet={srcSet(header)}
      sizes="100vw"
      alt=""
    />
  );
}

function sortedByStart(events: PublicEvent[]): PublicEvent[] {
  return [...events].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export function Classique({ card, theme, settings, events, urls, labels, mode }: TemplateProps<ClassiqueSettings>) {
  const { content, links } = card;
  const name = [content.first_name, content.last_name].filter(Boolean).join(" ");
  const header = headerMedia(card.header);
  const avatarSrc = card.avatar?.jpeg_url ?? (card.avatar ? largestImageUrl(card.avatar) : undefined);
  const sortedEvents = sortedByStart(events);
  // Defence in depth (PUB-022): the API only stores http(s) links, an unsafe one is not rendered. The original
  // index stays in the test id.
  const safeLinks = links.map((link, index) => ({ link, index })).filter(({ link }) => isHttpUrl(link.url));
  const iconsOnly = settings.links_layout === "icons";

  return (
    <article
      data-mode={mode}
      className="min-h-screen"
      style={{
        ...themeStyle(theme),
        background: "var(--card-bg)",
        color: "var(--card-text)",
        fontFamily: "var(--card-font-body)",
      }}
    >
      <div className="mx-auto max-w-md pb-10">
        <div className="relative h-56 w-full overflow-hidden">
          {header}
          {header && (
            <div
              data-testid="card-header-gradient"
              aria-hidden="true"
              className="absolute inset-0"
              style={GRADIENT_STYLE}
            />
          )}
        </div>

        <div className="relative px-5">
          {avatarSrc && card.avatar && (
            <div className="-mt-16 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- see the header image above */}
              <img
                data-testid={TEST_IDS.avatar}
                className="h-32 w-32 rounded-full border-4 object-cover"
                style={{ borderColor: "var(--card-accent)" }}
                src={avatarSrc}
                srcSet={srcSet(card.avatar)}
                sizes="128px"
                alt={name}
              />
            </div>
          )}

          {sortedEvents.length > 0 && (
            <div className="mt-6 flex flex-col gap-3">
              {sortedEvents.map((event) => (
                <a
                  key={event.id}
                  data-testid={TEST_IDS.eventButton(event.id)}
                  href={urls.eventForm(event.id)}
                  className={`block px-4 py-3 text-center text-lg font-bold ${
                    settings.animate_events ? "motion-safe:animate-pulse" : ""
                  }`}
                  style={BUTTON_STYLE}
                >
                  {event.title}
                </a>
              ))}
            </div>
          )}

          <div className="mt-6 text-center">
            {name && (
              <h1
                data-testid={TEST_IDS.name}
                className="text-2xl font-bold"
                style={{ fontFamily: "var(--card-font-heading)" }}
              >
                {name}
              </h1>
            )}
            {content.job_title && (
              <p data-testid={TEST_IDS.jobTitle} className="mt-1 text-lg">
                {content.job_title}
              </p>
            )}
            {content.company && (
              <p data-testid={TEST_IDS.company} className="opacity-80">
                {content.company}
              </p>
            )}
            {content.description && (
              <p data-testid={TEST_IDS.description} className="mt-4 whitespace-pre-line">
                {content.description}
              </p>
            )}
          </div>

          {(content.email || content.phone) && (
            <div className="mt-6 flex flex-col items-center gap-2">
              {content.email && (
                <a
                  data-testid={TEST_IDS.email}
                  href={mailtoHref(content.email)}
                  className="inline-flex items-center gap-2 underline"
                >
                  <Mail aria-hidden="true" className="h-4 w-4" />
                  {content.email}
                </a>
              )}
              {content.phone && (
                <a
                  data-testid={TEST_IDS.phone}
                  href={telHref(content.phone)}
                  className="inline-flex items-center gap-2 underline"
                >
                  <Phone aria-hidden="true" className="h-4 w-4" />
                  {content.phone_display ?? content.phone}
                </a>
              )}
            </div>
          )}

          {safeLinks.length > 0 && (
            <ul
              className={
                iconsOnly ? "mt-6 flex flex-wrap justify-center gap-3" : "mt-6 flex flex-col gap-3"
              }
            >
              {safeLinks.map(({ link, index }) => {
                // A kind this build does not know (a newer backend) reads as a website (TPL-016).
                const Icon = Object.hasOwn(LINK_ICONS, link.kind) ? LINK_ICONS[link.kind] : Globe;
                const label = linkLabel(labels, link);
                return (
                  <li key={`${index}-${link.url}`}>
                    <a
                      data-testid={TEST_IDS.link(index)}
                      href={link.url}
                      rel="noopener noreferrer"
                      aria-label={iconsOnly ? label : undefined}
                      title={iconsOnly ? label : undefined}
                      className={
                        iconsOnly
                          ? "flex h-12 w-12 items-center justify-center"
                          : "flex items-center justify-center gap-2 px-4 py-3 font-medium"
                      }
                      style={BUTTON_STYLE}
                    >
                      <Icon aria-hidden="true" className="h-5 w-5" />
                      {!iconsOnly && label}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-8 flex justify-center">
            <a
              data-testid={TEST_IDS.saveContact}
              href={urls.vcard}
              download
              className="inline-flex items-center gap-2 px-5 py-3 font-semibold"
              style={BUTTON_STYLE}
            >
              <Download aria-hidden="true" className="h-5 w-5" />
              {labels.saveContact}
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}
