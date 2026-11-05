import { describe, expect, test } from "vitest";
import { contrastRatio, mixOklab, over, parseHex, relativeLuminance, toHex } from "./color";

describe("color", () => {
  test("TPL-018 hex round-trips and luminance spans 0 to 1", () => {
    expect(toHex(parseHex("#2F55D4"))).toBe("#2f55d4");
    expect(relativeLuminance(parseHex("#000000"))).toBe(0);
    expect(relativeLuminance(parseHex("#ffffff"))).toBeCloseTo(1, 10);
  });

  test("TPL-018 contrast ratio matches WCAG", () => {
    expect(contrastRatio(parseHex("#000000"), parseHex("#ffffff"))).toBeCloseTo(21, 5);
    expect(contrastRatio(parseHex("#ffffff"), parseHex("#ffffff"))).toBeCloseTo(1, 5);
  });

  test("TPL-018 mixing in Oklab keeps the ends and blends the middle", () => {
    const a = parseHex("#1B1A17");
    const b = parseHex("#F7F6F2");
    expect(toHex(mixOklab(a, b, 1))).toBe("#1b1a17");
    expect(toHex(mixOklab(a, b, 0))).toBe("#f7f6f2");
  });

  test("TPL-018 a translucent colour is laid over the background on encoded values", () => {
    expect(over([0, 0, 0], [1, 1, 1], 0.12)).toEqual([0.88, 0.88, 0.88]);
  });
});
