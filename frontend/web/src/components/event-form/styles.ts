import type { CSSProperties } from "react";

// The prospect screens wear the card's theme (TPL-020): these read the CSS variables of `themeToCssVars`.

export const BUTTON_STYLE: CSSProperties = {
  borderRadius: "var(--radius-btn)",
  border: "2px solid var(--c-accent)",
  background: "color-mix(in srgb, var(--c-accent) 14%, transparent)",
};

export const INPUT_STYLE: CSSProperties = {
  border: "1px solid color-mix(in srgb, var(--c-text) 40%, transparent)",
  background: "color-mix(in srgb, var(--c-text) 4%, transparent)",
  color: "inherit",
};

export const HEADING_STYLE: CSSProperties = { fontFamily: "var(--font-title)" };

export const INPUT_CLASS = "block w-full rounded-md px-3 py-2 text-base outline-none focus-visible:ring-2";
