import { createTranslator } from "next-intl";
import { describe, expect, test } from "vitest";
import { cardView } from "@/components/cards/card-view.fixture";
import messages from "../../../messages/fr.json";
import { draftFromCard, type CardDraft } from "./draft";
import { sectionSummary } from "./section-summary";

const translator = createTranslator({ locale: "fr", messages });
const t = (key: string, values?: Record<string, string | number>) =>
  (translator as unknown as (key: string, values?: Record<string, string | number>) => string)(key, values);

const image = { id: "m1", kind: "image" as const, images: [], jpeg_url: "https://media.example.test/m1.jpg" };
const video = { ...image, id: "m2", kind: "video" as const };

function draft(patch: Partial<CardDraft> = {}): CardDraft {
  return { ...draftFromCard(cardView({ content: { first_name: "Zoé", last_name: "Lefèvre ✨" } })), ...patch };
}

describe("sectionSummary", () => {
  test("EDI-003 Identité sums up as the full name", () => {
    expect(sectionSummary("identity", draft(), t)).toBe("Zoé Lefèvre ✨");
    const unnamed = draft();
    unnamed.content = { ...unnamed.content, first_name: "", last_name: "" };
    expect(sectionSummary("identity", unnamed, t)).toBe("Carte sans nom");
  });

  test("EDI-003 Coordonnées sums up as email · phone, leaving out what is empty", () => {
    const both = draft();
    both.content = { ...both.content, email: "zoe@example.test", phone: "06 39 98 42 17" };
    expect(sectionSummary("contact", both, t)).toBe("zoe@example.test · 06 39 98 42 17");
    expect(sectionSummary("contact", { ...both, content: { ...both.content, phone: "" } }, t)).toBe("zoe@example.test");
    expect(sectionSummary("contact", draft(), t)).toBe("Aucune coordonnée");
  });

  test("EDI-003 Liens counts the networks and the free links", () => {
    const site = { kind: "website" as const, url: "https://zoe.example.test", label: "" };
    const instagram = { kind: "instagram" as const, url: "https://instagram.com/zoe", label: "" };
    const free = { kind: "custom" as const, url: "https://zoe.example.test/tarifs", label: "Tarifs" };
    expect(sectionSummary("links", draft({ links: [site, instagram, free] }), t)).toBe("2 réseaux · 1 lien libre");
    expect(sectionSummary("links", draft({ links: [site] }), t)).toBe("1 réseau");
    expect(sectionSummary("links", draft({ links: [free, free] }), t)).toBe("2 liens libres");
    expect(sectionSummary("links", draft({ links: [] }), t)).toBe("Aucun lien");
  });

  test("EDI-003 Médias names the header and the profile photo", () => {
    expect(sectionSummary("media", draft({ header: video, avatar: image }), t)).toBe(
      "Vidéo d’en-tête · photo de profil",
    );
    expect(sectionSummary("media", draft({ header: image, avatar: null }), t)).toBe("Photo d’en-tête");
    expect(sectionSummary("media", draft({ header: null, avatar: image }), t)).toBe("Photo de profil");
    expect(sectionSummary("media", draft({ header: null, avatar: null }), t)).toBe("Aucun média");
  });

  test("EDI-003 TPL-027 Template names the template and its links layout", () => {
    expect(sectionSummary("template", draft(), t)).toBe("Classique · liens en icônes");
    expect(sectionSummary("template", draft({ settings: { links_layout: "list" } }), t)).toBe(
      "Classique · liens en liste",
    );
  });

  test("EDI-030 Thème is the theme's name, then personnalisé once a setting changed", () => {
    expect(sectionSummary("theme", draft({ theme: { preset: "terracotta" } }), t)).toBe("Terracotta");
    // Setting a value to the theme's own is no change.
    expect(sectionSummary("theme", draft({ theme: { preset: "terracotta", accent: "#b3441e" } }), t)).toBe(
      "Terracotta",
    );
    expect(sectionSummary("theme", draft({ theme: { preset: "terracotta", text: "#111111" } }), t)).toBe(
      "Terracotta, personnalisé",
    );
  });
});
