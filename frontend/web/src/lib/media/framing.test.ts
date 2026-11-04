import { describe, expect, test } from "vitest";
import {
  coveredZones,
  cropFromPercentages,
  HEADER_RATIO,
  loopRestart,
  needsCrop,
  nudge,
  videoCropStyle,
  zoomStep,
} from "./framing";

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

  test("EDI-026 percentages become a crop rect", () => {
    expect(cropFromPercentages({ x: 12.5, y: 0, width: 75, height: 100 })).toEqual({ x: 0.125, y: 0, width: 0.75, height: 1 });
    // react-easy-crop may report a few hundredths outside the media: the rect stays within the source.
    const clamped = cropFromPercentages({ x: -0.01, y: 25.02, width: 100.01, height: 75 });
    expect(clamped).toEqual({ x: 0, y: 0.25, width: 1, height: 0.75 });
    const edge = cropFromPercentages({ x: 50.02, y: 0, width: 50, height: 100 });
    expect(edge.x + edge.width).toBeLessThanOrEqual(1);
  });

  test("EDI-026 a file is framed when it is not 4:3 within 1 %", () => {
    expect(needsCrop(800, 600, HEADER_RATIO)).toBe(false);
    expect(needsCrop(1000, 752, HEADER_RATIO)).toBe(false);
    expect(needsCrop(1280, 720, HEADER_RATIO)).toBe(true);
    expect(needsCrop(600, 800, HEADER_RATIO)).toBe(true);
    expect(needsCrop(512, 512, 1)).toBe(false);
  });

  test("EDI-026 arrows and plus/minus move and zoom within bounds", () => {
    const crop = { x: 0.2, y: 0.1, width: 0.5, height: 0.6 };
    // The arrows move the media: the frame goes the other way over the source, by 2 % of the frame.
    expect(nudge(crop, { key: "ArrowRight", shiftKey: false })).toEqual({ ...crop, x: 0.19 });
    expect(nudge(crop, { key: "ArrowLeft", shiftKey: false })).toEqual({ ...crop, x: 0.21 });
    expect(nudge(crop, { key: "ArrowDown", shiftKey: false })).toEqual({ ...crop, y: 0.088 });
    expect(nudge(crop, { key: "ArrowUp", shiftKey: true })).toEqual({ ...crop, y: 0.16 });
    // The frame never leaves the source.
    expect(nudge({ ...crop, x: 0.01 }, { key: "ArrowRight", shiftKey: true })).toEqual({ ...crop, x: 0 });
    expect(nudge({ ...crop, x: 0.49 }, { key: "ArrowLeft", shiftKey: true })).toEqual({ ...crop, x: 0.5 });
    expect(nudge(crop, { key: "Enter", shiftKey: false })).toBeNull();

    expect(zoomStep(1, "+")).toBe(1.1);
    expect(zoomStep(1.25, "=")).toBe(1.35);
    expect(zoomStep(2, "-")).toBe(1.9);
    expect(zoomStep(2, "−")).toBe(1.9);
    expect(zoomStep(1.05, "-")).toBe(1);
    expect(zoomStep(2.95, "+")).toBe(3);
    expect(zoomStep(3, "+")).toBe(3);
    expect(zoomStep(2, "a")).toBeNull();
  });

  test("EDI-026 covered zones follow the header gradient", () => {
    const zones = coveredZones(55);
    expect(zones.fade).toEqual({ left: 0, top: 0.45, width: 1, height: 0.55 });
    // The 112 px avatar of a 448 px wide card, going 64 px up into the bottom of its 336 px high header.
    expect(zones.avatar.width).toBeCloseTo(0.25);
    expect(zones.avatar.left).toBeCloseTo(0.375);
    expect(zones.avatar.height).toBeCloseTo(112 / 336);
    expect(zones.avatar.top).toBeCloseTo(1 - 64 / 336);
    // The 44 px pause button, 12 px from the top-right corner.
    expect(zones.pause.width).toBeCloseTo(44 / 448);
    expect(zones.pause.left + zones.pause.width).toBeCloseTo(1 - 12 / 448);
    expect(zones.pause.top).toBeCloseTo(12 / 336);
    expect(zones.pause.height).toBeCloseTo(44 / 336);

    expect(coveredZones(0).fade).toEqual({ left: 0, top: 1, width: 1, height: 0 });
    expect(coveredZones(100).fade).toEqual({ left: 0, top: 0, width: 1, height: 1 });
  });
});
