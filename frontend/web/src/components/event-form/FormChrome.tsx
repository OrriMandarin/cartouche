import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PublicCard } from "@/templates/contract";
import { initials } from "@/templates/link-display";

/** The card's full name, as the card shows it. */
export function cardFullName(card: PublicCard): string {
  return [card.content.first_name, card.content.last_name].filter(Boolean).join(" ");
}

/** The way back to the card, with its photo (or initials, PUB-023) and its name (FRM-001, FRM-044). */
export function BackLink({ card, href }: { card: PublicCard; href: string }) {
  const { avatar, content } = card;
  const src = avatar?.jpeg_url ?? avatar?.images.at(-1)?.url;
  const letters = initials(content.first_name, content.last_name);
  return (
    <a data-testid="event-form-back" className="fm-back" href={href}>
      <ChevronLeft className="ic" aria-hidden="true" />
      {avatar && src ? (
        <span className="fm-back-av">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 32-pixel thumbnail of the card's own files */}
          <img
            src={src}
            srcSet={avatar.images.map((image) => `${image.url} ${image.width}w`).join(", ")}
            sizes="32px"
            alt=""
          />
        </span>
      ) : (
        letters && (
          <span className="fm-back-av is-initials" aria-hidden="true">
            {letters}
          </span>
        )
      )}
      <span>{cardFullName(card)}</span>
    </a>
  );
}

/**
 * The band in the accent colour (FRM-044): the "Événement en cours" label and the description only on the
 * form itself; the code and closed screens show the title alone (FRM-048, EVT-027).
 */
export function FormHead({ title, description, live }: { title: string; description?: string | null; live: boolean }) {
  const t = useTranslations("eventForm");
  return (
    <header className="fm-head">
      {live && (
        <p className="fm-live">
          <span className="cc-dot" aria-hidden="true" />
          {t("live")}
        </p>
      )}
      <h1 data-testid="event-form-title" className="fm-title">
        {title}
      </h1>
      {description && (
        <p data-testid="event-form-description" className="fm-intro">
          {description}
        </p>
      )}
    </header>
  );
}
