import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { InactiveCard } from "@/components/public/InactiveCard";
import { buildCardUrls, fetchPublicCard, toPublicEvents } from "@/lib/public-card";
import { buildCardMetadata, INACTIVE_METADATA } from "@/lib/og";
import { buildTemplateLabels } from "@/templates/contract";
import { renderTemplate } from "@/templates/registry";

type PageProps = { params: Promise<{ slug: string }> };

// No `cache` hint of our own: `fetchPublicCard` reads the API with `no-store`, which makes the page dynamic.

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await fetchPublicCard(slug);
  if (result?.state === "active") return buildCardMetadata(result.card);
  // A redirect or a 404 renders no page of its own; the neutral page must say nothing of the card.
  return result?.state === "inactive" ? INACTIVE_METADATA : {};
}

/** The public page of a card, rendered by the server (PUB-002). */
export default async function PublicCardPage({ params }: PageProps) {
  const { slug } = await params;
  const result = await fetchPublicCard(slug);

  if (result === null) notFound();
  if (result.state === "redirect") permanentRedirect(`/c/${encodeURIComponent(result.slug)}`);
  if (result.state === "inactive") return <InactiveCard />;

  const { card } = result;
  const t = await getTranslations();
  return renderTemplate({
    template: card.template,
    settings: card.settings,
    theme: card.theme,
    card,
    events: toPublicEvents(card),
    urls: buildCardUrls(card),
    labels: buildTemplateLabels(t),
    mode: "public",
  });
}
