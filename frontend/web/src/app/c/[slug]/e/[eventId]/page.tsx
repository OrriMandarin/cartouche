import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ClosedEvent } from "@/components/event-form/ClosedEvent";
import { EventFormPage } from "@/components/event-form/EventFormPage";
import "@/components/event-form/event-form.css";
import { CardStage } from "@/components/public/CardStage";
import { eventFormPath } from "@/lib/card-urls";
import { fetchPublicCard } from "@/lib/public-card";
import { fetchPublicEvent } from "@/lib/public-event";
import { resolveTheme } from "@/lib/theme/resolve";

type PageProps = { params: Promise<{ slug: string; eventId: string }> };

// A form is for the people at the event, not for search engines.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The form of an event, rendered by the server (FRM-024, PUB-002), common to every template (TPL-020). */
export default async function EventFormRoute({ params }: PageProps) {
  const { slug, eventId } = await params;
  const result = await fetchPublicCard(slug);

  // An unserved card never gets here: the layout has already answered with the card's neutral page (LNK-007).
  if (result === null || result.state === "inactive") notFound();
  // `fetchPublicCard` reads with `no-store`: the page is dynamic and Next sends the 308 with no-store (LNK-030).
  if (result.state === "redirect") permanentRedirect(eventFormPath(result.slug, eventId));

  const { card } = result;
  const event = await fetchPublicEvent(card.slug, eventId);
  // Unknown event: this segment's `not-found.tsx`, "Formulaire introuvable" (FRM-024).
  if (event === null || event.state === "inactive") notFound();

  return (
    <CardStage theme={resolveTheme(card.theme)}>
      <main data-testid="event-form-page">
        {/* The card's frame and its theme (FRM-049, PUB-037); never the styles of a template. */}
        <article className="cc">
          <div className="fm">
            {event.state === "closed" ? (
              <ClosedEvent slug={card.slug} title={event.event.title} />
            ) : (
              <EventFormPage slug={card.slug} card={card} initial={event} />
            )}
          </div>
        </article>
      </main>
    </CardStage>
  );
}
