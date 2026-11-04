import { describe, expect, test } from "vitest";
import { backgroundCss } from "./background";

describe("backgroundCss", () => {
  test("TPL-017 a solid background is its colour", () => {
    expect(backgroundCss({ kind: "solid", color: "#FAF7F0" })).toBe("#FAF7F0");
  });

  test("TPL-017 a gradient background is a linear gradient at its angle", () => {
    expect(backgroundCss({ kind: "gradient", angle: 160, from: "#111111", to: "#222222" })).toBe(
      "linear-gradient(160deg, #111111, #222222)",
    );
  });
});
