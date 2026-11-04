import type { CSSProperties } from "react";
import type { CropRect, VideoLoop } from "./upload";

/** Tolerance, in seconds, around the loop bounds: `timeupdate` fires a few times per second. */
const LOOP_MARGIN = 0.05;

/**
 * Places a video in its header so that only the stored crop shows (MED-032): the file is scaled up by the
 * inverse of the crop and shifted. Without a crop (media uploaded before framing existed), it covers (MED-033).
 */
export function videoCropStyle(crop: CropRect | null | undefined): CSSProperties {
  if (!crop) {
    return { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" };
  }
  return {
    position: "absolute",
    left: `${(-crop.x / crop.width) * 100}%`,
    top: `${(-crop.y / crop.height) * 100}%`,
    width: `${100 / crop.width}%`,
    height: `${100 / crop.height}%`,
    maxWidth: "none",
    objectFit: "fill",
  };
}

/** The time to seek to for the video to stay in its loop (MED-032), or null to let it play on. */
export function loopRestart(currentTime: number, loop: VideoLoop | null | undefined, duration: number): number | null {
  if (!loop) return currentTime >= duration - LOOP_MARGIN ? 0 : null;
  if (currentTime >= loop.end - LOOP_MARGIN || currentTime < loop.start - LOOP_MARGIN) return loop.start;
  return null;
}
