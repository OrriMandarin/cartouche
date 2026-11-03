import { ArrowUpRight, ChevronRight, Mail, Phone, UserPlus } from "lucide-react";
import { createElement } from "react";
import { themeToCssVars } from "@/lib/theme/css-vars";
import "@/components/public/public-page.css";
import { isHttpUrl, mailtoHref, telHref } from "../contact-links";
import {
  TEMPLATE_TEST_IDS as TEST_IDS,
  type MediaView,
  type PublicEvent,
  type TemplateLabels,
  type TemplateProps,
} from "../contract";
import {
  initials,
  linkAddress,
  linkAriaLabel,
  linkIcon,
  linkName,
  splitLinksForIcons,
  type Indexed,
} from "../link-display";
import "./classique.css";
import type { ClassiqueSettings } from "./settings";

function srcSet(media: MediaView): string {
  return media.images.map((image) => `${image.url} ${image.width}w`).join(", ");
}

function largestImageUrl(media: MediaView): string | undefined {
  return media.images.at(-1)?.url;
}

/** The header image or video; without media, a short band tinted with the accent (PUB-004, PUB-023). */
function HeaderMedia({ header }: { header: MediaView | null | undefined }) {
  if (header?.kind === "video" && header.video_url) {
    return (
      <div className="cc-media">
        <video
          data-testid={TEST_IDS.headerVideo}
          src={header.video_url}
          poster={largestImageUrl(header)}
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
        />
      </div>
    );
  }
  const src = header ? largestImageUrl(header) : undefined;
  if (!header || !src) {
    return <div className="cc-media is-empty" data-testid={TEST_IDS.headerEmpty} aria-hidden="true" />;
  }
  return (
    <div className="cc-media">
      {/* A plain img: media URLs are absolute and external, and next/image would add an optimizer hop. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        data-testid={TEST_IDS.headerImage}
        src={src}
        srcSet={srcSet(header)}
        sizes="(min-width: 40rem) 28rem, 100vw"
        alt=""
      />
    </div>
  );
}

function sortedByStart(events: PublicEvent[]): PublicEvent[] {
  return [...events].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** The icon of a link's kind, picked from a fixed table (PUB-036). */
function linkGlyph(kind: string) {
  return createElement(linkIcon(kind), { className: "ic" });
}

/** A link as a row: its icon, its name, its address and an arrow (PUB-035, PUB-036). */
function LinkRow({ link, index, labels }: Indexed & { labels: TemplateLabels }) {
  return (
    <li>
      <a className="cc-row" data-testid={TEST_IDS.link(index)} href={link.url} rel="noopener noreferrer">
        {linkGlyph(link.kind)}
        <span className="cc-row-txt">
          <span className="cc-row-label">{linkName(labels, link)}</span>
          <span className="cc-row-sub">{linkAddress(link.url)}</span>
        </span>
        <ArrowUpRight className="ic cc-row-end" aria-hidden="true" />
      </a>
    </li>
  );
}

function LinkRows({ links, labels }: { links: Indexed[]; labels: TemplateLabels }) {
  if (links.length === 0) return null;
  return (
    <ul className="cc-list" aria-label={labels.linksList}>
      {links.map(({ link, index }) => (
        <LinkRow key={`${index}-${link.url}`} link={link} index={index} labels={labels} />
      ))}
    </ul>
  );
}

/** Known kinds as 48-pixel icon buttons, free-form links as rows under them (PUB-035). */
function LinkIcons({ icons, rows, labels }: { icons: Indexed[]; rows: Indexed[]; labels: TemplateLabels }) {
  if (icons.length === 0 && rows.length === 0) return null;
  return (
    <div className="cc-iconset">
      {icons.length > 0 && (
        <ul className="cc-icons" aria-label={labels.networks}>
          {icons.map(({ link, index }) => (
            <li key={`${index}-${link.url}`}>
              <a
                className="cc-icon"
                data-testid={TEST_IDS.link(index)}
                href={link.url}
                rel="noopener noreferrer"
                aria-label={linkAriaLabel(labels, link)}
              >
                {linkGlyph(link.kind)}
              </a>
            </li>
          ))}
        </ul>
      )}
      <LinkRows links={rows} labels={labels} />
    </div>
  );
}

export function Classique({ card, theme, settings, events, urls, labels, mode }: TemplateProps<ClassiqueSettings>) {
  const { content } = card;
  const name = [content.first_name, content.last_name].filter(Boolean).join(" ");
  const avatarSrc = card.avatar?.jpeg_url ?? (card.avatar ? largestImageUrl(card.avatar) : undefined);
  const avatarInitials = initials(content.first_name, content.last_name);
  const sortedEvents = sortedByStart(events);
  // Defence in depth (PUB-022): the API only stores http(s) links, an unsafe one is not rendered. The original
  // index stays in the test id.
  const isSafe = ({ link }: Indexed) => isHttpUrl(link.url);
  const split = splitLinksForIcons(card.links);
  const iconLinks = split.icons.filter(isSafe);
  const freeLinks = split.rows.filter(isSafe);
  const allLinks = card.links.map((link, index) => ({ link, index })).filter(isSafe);

  return (
    <article className="cc" data-mode={mode} data-shape={theme.buttonShape} style={themeToCssVars(theme)}>
      <header className="cc-head">
        <HeaderMedia header={card.header} />
        {card.avatar && avatarSrc ? (
          <div className="cc-avatar">
            {/* eslint-disable-next-line @next/next/no-img-element -- see the header image */}
            <img
              data-testid={TEST_IDS.avatar}
              src={avatarSrc}
              srcSet={srcSet(card.avatar)}
              sizes="112px"
              alt={name}
            />
          </div>
        ) : (
          avatarInitials && (
            <div className="cc-avatar is-initials" data-testid={TEST_IDS.initials} aria-hidden="true">
              {avatarInitials}
            </div>
          )
        )}
      </header>

      <div className="cc-body">
        {sortedEvents.length > 0 && (
          <div className="cc-events">
            {sortedEvents.map((event) => (
              <a
                key={event.id}
                className="cc-event"
                data-testid={TEST_IDS.eventButton(event.id)}
                href={urls.eventForm(event.id)}
              >
                <span className="cc-event-txt">
                  <span className="cc-event-live">
                    <span className="cc-dot" aria-hidden="true" />
                    {labels.eventLive}
                  </span>
                  <span className="cc-event-name" data-testid={TEST_IDS.eventName}>
                    {event.title}
                  </span>
                </span>
                <ChevronRight className="ic" aria-hidden="true" />
              </a>
            ))}
          </div>
        )}

        <div className="cc-id">
          {name && (
            <h1 className="cc-name" data-testid={TEST_IDS.name}>
              {name}
            </h1>
          )}
          {content.job_title && (
            <p className="cc-role" data-testid={TEST_IDS.jobTitle}>
              {content.job_title}
            </p>
          )}
          {content.company && (
            <p className="cc-company" data-testid={TEST_IDS.company}>
              {content.company}
            </p>
          )}
          {content.description && (
            <p className="cc-desc" data-testid={TEST_IDS.description}>
              {content.description}
            </p>
          )}
        </div>

        <a className="cc-save" data-testid={TEST_IDS.saveContact} href={urls.vcard} download>
          <UserPlus className="ic" aria-hidden="true" />
          {labels.saveContact}
        </a>

        {(content.email || content.phone) && (
          <ul className="cc-list" aria-label={labels.contacts}>
            {content.email && (
              <li>
                <a className="cc-row" data-testid={TEST_IDS.email} href={mailtoHref(content.email)}>
                  <Mail className="ic" aria-hidden="true" />
                  <span className="cc-row-txt">
                    <span className="cc-row-label">{content.email}</span>
                    <span className="cc-row-sub">{labels.emailLabel}</span>
                  </span>
                </a>
              </li>
            )}
            {content.phone && (
              <li>
                <a className="cc-row" data-testid={TEST_IDS.phone} href={telHref(content.phone)}>
                  <Phone className="ic" aria-hidden="true" />
                  <span className="cc-row-txt">
                    <span className="cc-row-label">{content.phone_display ?? content.phone}</span>
                    <span className="cc-row-sub">{labels.phoneLabel}</span>
                  </span>
                </a>
              </li>
            )}
          </ul>
        )}

        {settings.links_layout === "list" ? (
          <LinkRows links={allLinks} labels={labels} />
        ) : (
          <LinkIcons icons={iconLinks} rows={freeLinks} labels={labels} />
        )}
      </div>
    </article>
  );
}
