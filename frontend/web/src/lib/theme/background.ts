import type { ThemeBackground } from "./presets";

/** The CSS `background` of a theme background: a flat colour or a linear gradient. */
export function backgroundCss(background: ThemeBackground): string {
  return background.kind === "solid"
    ? background.color
    : `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})`;
}
