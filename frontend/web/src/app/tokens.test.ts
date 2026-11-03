import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const read = (relative: string) => readFileSync(join(__dirname, relative), "utf8");

const FAMILIES = [
  "inter",
  "playfair-display",
  "source-sans-3",
  "fraunces",
  "nunito-sans",
  "bricolage-grotesque",
  "instrument-sans",
  "jetbrains-mono",
];

describe("fonts and tokens", () => {
  test("TPL-012 fonts.css imports the eight self-hosted families and nothing remote", () => {
    const css = read("../lib/theme/fonts.css");
    const imported = [...css.matchAll(/@import "@fontsource-variable\/([a-z0-9-]+)\/(?:wght|index)\.css";/g)].map(
      (m) => m[1],
    );
    expect(imported).toEqual(FAMILIES);
    expect(css).not.toContain("http");
    expect(css).not.toContain("fonts.googleapis");
  });

  test("TPL-026 no --c- variable is declared in the global stylesheets", () => {
    for (const file of ["globals.css", "tokens.css"]) {
      expect(read(file)).not.toMatch(/--c-[a-z0-9-]+\s*:/);
    }
  });

  test("TPL-026 the app tokens are --app- variables only", () => {
    const css = read("tokens.css");
    const rootBody = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(rootBody).not.toBe("");
    const names = [...rootBody.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1] ?? "");
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name.startsWith("--app-")).toBe(true);
  });
});
