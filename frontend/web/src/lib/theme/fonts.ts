/** Font pairs for card themes (TPL-011); the families come from the self-hosted fonts.css. */
export interface FontPair {
  id: string;
  /** Message key of the display name. */
  nameKey: string;
  /** CSS font-family value for headings. */
  heading: string;
  /** CSS font-family value for body text. */
  body: string;
}

export const DEFAULT_FONT_ID = "moderne";

export const FONT_PAIRS: readonly FontPair[] = [
  {
    id: "moderne",
    nameKey: "fonts.moderne",
    heading: '"Inter Variable", system-ui, sans-serif',
    body: '"Inter Variable", system-ui, sans-serif',
  },
  {
    id: "editorial",
    nameKey: "fonts.editorial",
    heading: '"Playfair Display Variable", Georgia, serif',
    body: '"Source Sans 3 Variable", system-ui, sans-serif',
  },
  {
    id: "chaleureux",
    nameKey: "fonts.chaleureux",
    heading: '"Fraunces Variable", Georgia, serif',
    body: '"Nunito Sans Variable", system-ui, sans-serif',
  },
];
