import { describe, expect, test } from "vitest";
import { loopRestart, videoCropStyle } from "./framing";

describe("framing", () => {
  test("MED-032 the crop style scales and shifts the video to show only the crop", () => {
    expect(videoCropStyle({ x: 0.25, y: 0, width: 0.5, height: 1 })).toEqual({
      position: "absolute",
      left: "-50%",
      top: "0%",
      width: "200%",
      height: "100%",
      maxWidth: "none",
      objectFit: "fill",
    });
  });

  test("MED-033 without crop the video covers the header", () => {
    expect(videoCropStyle(null)).toEqual({
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "cover",
    });
  });

  test("MED-032 the loop returns to its start at its end", () => {
    const loop = { start: 0.8, end: 8.3 };
    expect(loopRestart(8.3, loop, 10)).toBe(0.8);
    expect(loopRestart(4, loop, 10)).toBeNull();
    expect(loopRestart(0.1, loop, 10)).toBe(0.8);
  });

  test("MED-033 without loop the video restarts from zero at its end", () => {
    expect(loopRestart(9.97, null, 10)).toBe(0);
    expect(loopRestart(4, null, 10)).toBeNull();
  });
});
