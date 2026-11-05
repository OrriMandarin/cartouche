import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CardStage } from "@/components/public/CardStage";
import { buildCardUrls, fetchPublicCard, toPublicEvents } from "@/lib/public-card";
import { buildCardMetadata, INACTIVE_METADATA } from "@/lib/og";
import { resolveTheme } from "@/lib/theme/resolve";
import { buildTemplateLabels } from "@/templates/contract";
import { renderTemplate } from "@/templates/registry";

type PageProps = { params: Promise<{ slug: string }> };

// No `cache` hint of our own: `fetchPublicCard` reads the API with `no-store`, which makes the page dynamic.

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await fetchPublicCard(slug);
  if (result?.state === "active") return buildCardMetadata(result.card);
  // A redirect renders no page of its own; the neutral page must say nothing of the card (LNK-027).
  return result?.state === "redirect" ? {} : INACTIVE_METADATA;
}

/** The public page of a card, rendered by the server (PUB-002). */
export default async function PublicCardPage({ params }: PageProps) {
  const { slug } = await params;
  const result = await fetchPublicCard(slug);

  // Unknown, disabled or blocked: the same neutral 404 page, `not-found.tsx` (LNK-023, LNK-027).
  if (result === null || result.state === "inactive") notFound();
  if (result.state === "redirect") permanentRedirect(`/c/${encodeURIComponent(result.slug)}`);

  const { card } = result;
  const t = await getTranslations();
  return (
    <CardStage theme={resolveTheme(card.theme)}>
      {renderTemplate({
        template: card.template,
        settings: card.settings,
        theme: card.theme,
        card,
        events: toPublicEvents(card),
        urls: buildCardUrls(card),
        labels: buildTemplateLabels(t),
        mode: "public",
      })}
    </CardStage>
  );
}
