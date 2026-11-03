import type { CSSProperties } from "react";

// The prospect screens wear the card's theme (TPL-020): these read the CSS variables of `themeStyle`.

export const BUTTON_STYLE: CSSProperties = {
  borderRadius: "var(--card-radius)",
  border: "2px solid var(--card-accent)",
  background: "color-mix(in srgb, var(--card-accent) 14%, transparent)",
};

export const INPUT_STYLE: CSSProperties = {
  border: "1px solid color-mix(in srgb, var(--card-text) 40%, transparent)",
  background: "color-mix(in srgb, var(--card-text) 4%, transparent)",
  color: "inherit",
};

export const HEADING_STYLE: CSSProperties = { fontFamily: "var(--card-font-heading)" };

export const INPUT_CLASS = "block w-full rounded-md px-3 py-2 text-base outline-none focus-visible:ring-2";
