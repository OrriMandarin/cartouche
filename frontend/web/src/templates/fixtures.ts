import messages from "../../messages/fr.json";
import { buildTemplateLabels, type PublicCard, type PublicEvent, type TemplateProps } from "./contract";

const media = "https://media.example.test/cards/c1";

/** A complete card: accents, an apostrophe, an emoji, three links (one free) and header and avatar images. */
export const sampleCard: PublicCard = {
  slug: "eloise-daubigne",
  public_url: "https://cartouche.example.test/c/eloise-daubigne",
  template: "classique",
  settings: {},
  theme: { preset: "clair" },
  content: {
    first_name: "Éloïse",
    last_name: "D'Aubigné-Müller",
    job_title: "Cheffe de projet numérique",
    company: "Atelier Müller & Fils",
    description: "Je conçois des services publics lisibles ✨\nBienvenue !",
    email: "eloise@example.com",
    phone: "+33612345678",
    phone_display: "+33 6 12 34 56 78",
  },
  links: [
    { kind: "website", url: "https://eloise-daubigne.example/portfolio?ref=carte&lang=fr" },
    { kind: "linkedin", url: "https://www.linkedin.com/in/eloise-daubigne-muller" },
    { kind: "custom", url: "https://podcast.example/épisodes?x=1#top", label: "Mon podcast ✨" },
  ],
  header: {
    id: "0198a1a0-0000-7000-8000-000000000001",
    kind: "image",
    images: [
      { width: 640, url: `${media}/h1/w640.webp` },
      { width: 1080, url: `${media}/h1/w1080.webp` },
      { width: 1920, url: `${media}/h1/w1920.webp` },
    ],
  },
  avatar: {
    id: "0198a1a0-0000-7000-8000-000000000002",
    kind: "image",
    images: [
      { width: 128, url: `${media}/a1/s128.webp` },
      { width: 256, url: `${media}/a1/s256.webp` },
      { width: 512, url: `${media}/a1/s512.webp` },
    ],
    jpeg_url: `${media}/a1/s512.jpg`,
  },
  vcard_url: "/api/public/cards/eloise-daubigne/vcard",
};

/** The same card with a video header; the waiting image is the largest of its images. */
export const sampleVideoHeader: NonNullable<PublicCard["header"]> = {
  id: "0198a1a0-0000-7000-8000-000000000003",
  kind: "video",
  images: [
    { width: 640, url: `${media}/v1/w640.webp` },
    { width: 1080, url: `${media}/v1/w1080.webp` },
  ],
  video_url: `${media}/v1/video.mp4`,
};

/** Two events, out of order on purpose. */
export const sampleEvents: PublicEvent[] = [
  { id: "evt-salon", title: "Salon de l'innovation ✨", startsAt: "2026-11-20T18:00:00Z" },
  { id: "evt-atelier", title: "Atelier d'écriture", startsAt: "2026-11-05T09:00:00Z" },
];

export const sampleUrls: TemplateProps<unknown>["urls"] = {
  vcard: "/api/public/cards/eloise-daubigne/vcard",
  eventForm: (eventId) => `/c/eloise-daubigne/events/${eventId}`,
};

/** Labels read from the real catalogue, as the caller would build them. */
export const sampleLabels = buildTemplateLabels((key) => {
  const value = key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
  if (typeof value !== "string") throw new Error(`missing message ${key}`);
  return value;
});
