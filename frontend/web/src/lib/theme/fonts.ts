import themesJson from "./themes.json";

export type FontPairId = "inter" | "playfair" | "fraunces" | "bricolage";

/** Font pairs for card themes (TPL-011); the families come from the self-hosted fonts.css (TPL-012). */
export interface FontPair {
  id: FontPairId;
  /** Message key of the display name. */
  nameKey: string;
  title: string;
  body: string;
  titleWeight: number;
  titleTracking: string;
  /** CSS font-family value for titles. */
  titleStack: string;
  /** CSS font-family value for body text. */
  bodyStack: string;
}

const SERIF_TITLES = ["Playfair Display", "Fraunces"];

export const DEFAULT_FONT_ID: FontPairId = "inter";

export const FONT_PAIRS: readonly FontPair[] = (
  Object.entries(themesJson.fontPairs) as [FontPairId, (typeof themesJson.fontPairs)[FontPairId]][]
).map(([id, pair]) => ({
  id,
  nameKey: `fonts.${id}`,
  title: pair.title,
  body: pair.body,
  titleWeight: pair.titleWeight,
  titleTracking: pair.titleTracking,
  titleStack: `'${pair.title} Variable', '${pair.title}', ${
    SERIF_TITLES.includes(pair.title) ? "Georgia, serif" : "system-ui, sans-serif"
  }`,
  bodyStack: `'${pair.body} Variable', '${pair.body}', system-ui, sans-serif`,
}));
