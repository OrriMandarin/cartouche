import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { fetchPublicCard } from "@/lib/public-card";
import { fetchPublicEvent } from "@/lib/public-event";

type LayoutProps = { children: ReactNode; params: Promise<{ slug: string; eventId: string }> };

/**
 * The card check of a form (LNK-007, FRM-024). A `notFound()` thrown here is caught by the boundary of the
 * card's segment, `c/[slug]/not-found.tsx`: the form of a card that is not served is the card's neutral 404
 * page, while the page's own `notFound()` (unknown event) keeps "Formulaire introuvable". Both reads are
 * wrapped in `cache`: the page reuses these answers.
 */
export default async function EventFormLayout({ children, params }: LayoutProps) {
  const { slug, eventId } = await params;
  const result = await fetchPublicCard(slug);

  if (result === null || result.state === "inactive") notFound();
  // The event API answers 410 when the card stopped being served between the two reads.
  if (result.state === "active" && (await fetchPublicEvent(result.card.slug, eventId))?.state === "inactive") {
    notFound();
  }
  return children;
}
