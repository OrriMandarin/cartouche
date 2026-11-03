import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ClosedEvent } from "@/components/event-form/ClosedEvent";
import { EventFormPage } from "@/components/event-form/EventFormPage";
import { InactiveCard } from "@/components/public/InactiveCard";
import { eventFormPath } from "@/lib/card-urls";
import { fetchPublicCard } from "@/lib/public-card";
import { fetchPublicEvent } from "@/lib/public-event";
import { themeToCssVars } from "@/lib/theme/css-vars";
import { resolveTheme } from "@/lib/theme/resolve";

type PageProps = { params: Promise<{ slug: string; eventId: string }> };

// A form is for the people at the event, not for search engines.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The form of an event, rendered by the server (FRM-024, PUB-002), common to every template (TPL-020). */
export default async function EventFormRoute({ params }: PageProps) {
  const { slug, eventId } = await params;
  const result = await fetchPublicCard(slug);

  if (result === null) notFound();
  // `fetchPublicCard` reads with `no-store`: the page is dynamic and Next sends the 308 with no-store (LNK-030).
  if (result.state === "redirect") permanentRedirect(eventFormPath(result.slug, eventId));
  if (result.state === "inactive") return <InactiveCard />;

  const { card } = result;
  const event = await fetchPublicEvent(card.slug, eventId);
  if (event === null) notFound();
  if (event.state === "inactive") return <InactiveCard />;

  return (
    <main
      data-testid="event-form-page"
      className="min-h-screen"
      style={{
        ...themeToCssVars(resolveTheme(card.theme)),
        background: "linear-gradient(var(--bg-angle), var(--c-bg), var(--c-bg-2))",
        color: "var(--c-text)",
        fontFamily: "var(--font-body)",
      }}
    >
      {event.state === "closed" ? (
        <ClosedEvent slug={card.slug} title={event.event.title} />
      ) : (
        <EventFormPage slug={card.slug} card={card} initial={event} />
      )}
    </main>
  );
}
