import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { neutralTheme } from "@/lib/theme/resolve";
import { CardStage } from "./CardStage";

describe("CardStage", () => {
  test("PUB-042 the page carries a noscript style that removes the sheen and the blur", () => {
    const theme = neutralTheme();
    const html = renderToStaticMarkup(<CardStage theme={theme}>x</CardStage>);
    expect(html).toMatch(/<noscript><style>[^<]*\.cc-shimmer\s*\{\s*display:\s*none/);
    expect(html).toMatch(/<noscript><style>[^<]*\.is-blur\s*\{\s*filter:\s*none/);
  });

  test("PUB-006 PUB-042 without JavaScript the video placeholder is hidden so the video's own still image shows", () => {
    const theme = neutralTheme();
    const html = renderToStaticMarkup(<CardStage theme={theme}>x</CardStage>);
    expect(html).toMatch(/<noscript><style>[^<]*\.is-blur\s*\{[^}]*visibility:\s*hidden/);
  });
});
