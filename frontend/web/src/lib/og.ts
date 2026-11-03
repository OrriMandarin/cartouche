import type { Metadata } from "next";
import type { PublicCard } from "@/templates/contract";

/** Full name of the person, first name then last name; empty when the card has neither. */
export function fullName(content: PublicCard["content"]): string {
  return [content.first_name, content.last_name].filter(Boolean).join(" ");
}

/** Link preview of an active card (PUB-017, PUB-028): name, "job title · company", the 512 px JPEG, current link. */
export function buildCardMetadata(card: PublicCard): Metadata {
  const { content } = card;
  const title = fullName(content);
  const description = [content.job_title, content.company].filter(Boolean).join(" · ") || undefined;
  const image = card.avatar?.jpeg_url;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: card.public_url,
      ...(image ? { images: [image] } : {}),
    },
    twitter: { card: "summary" },
  };
}

/** The neutral page shows nothing of the card and asks search engines to stay away (LNK-027). */
export const INACTIVE_METADATA: Metadata = {
  robots: { index: false, follow: false },
};
