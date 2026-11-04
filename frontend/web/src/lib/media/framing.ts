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

/** The header is 4:3 (MED-015); the profile photo is square (MED-026). */
export const HEADER_RATIO = 4 / 3;
export const AVATAR_RATIO = 1;
/** Zoom bounds of the crop dialogs (EDI-026): 100 % shows the largest rectangle of the source, 300 % a third of it. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;
/** An arrow moves the media by 2 % of the frame, 10 % with Shift (EDI-026). */
const NUDGE_STEP = 0.02;
const NUDGE_STEP_SHIFT = 0.1;
/** The server accepts a crop whose shape is off by 1 % at most (MED-026). */
const SHAPE_TOLERANCE = 0.01;

/** An area of the source in percentages (0 to 100), as react-easy-crop reports it. */
export interface PercentArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Drops the floating-point noise of a sum of fractions, far below a source pixel. */
function tidy(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** spec: MED-026. A rect of the source in proportions, kept inside it. */
function withinSource(crop: CropRect): CropRect {
  const width = tidy(clamp(crop.width, 0, 1));
  const height = tidy(clamp(crop.height, 0, 1));
  return {
    x: tidy(clamp(crop.x, 0, 1 - width)),
    y: tidy(clamp(crop.y, 0, 1 - height)),
    width,
    height,
  };
}

/** spec: EDI-026, MED-026. The crop to send for an area chosen in the dialog (percentages of the source). */
export function cropFromPercentages(area: PercentArea): CropRect {
  return withinSource({ x: area.x / 100, y: area.y / 100, width: area.width / 100, height: area.height / 100 });
}

/** The area react-easy-crop starts from for a stored crop (proportions of the source). */
export function percentagesFromCrop(crop: CropRect): PercentArea {
  return { x: crop.x * 100, y: crop.y * 100, width: crop.width * 100, height: crop.height * 100 };
}

/** spec: EDI-026, EDI-035. Whether a file of these dimensions is off the slot's shape and must be framed first. */
export function needsCrop(width: number, height: number, ratio: number): boolean {
  return Math.abs(width / height / ratio - 1) > SHAPE_TOLERANCE;
}

const MOVES: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * spec: EDI-026. The crop after an arrow key, or null for any other key. The arrows move the media, so the frame
 * goes the other way over the source, by 2 % of the frame (10 % with Shift); it never leaves the source.
 */
export function nudge(crop: CropRect, key: { key: string; shiftKey: boolean }): CropRect | null {
  const move = MOVES[key.key];
  if (!move) return null;
  const step = key.shiftKey ? NUDGE_STEP_SHIFT : NUDGE_STEP;
  return withinSource({ ...crop, x: crop.x - move[0] * step * crop.width, y: crop.y - move[1] * step * crop.height });
}

const ZOOM_KEYS: Record<string, 1 | -1> = { "+": 1, "=": 1, "-": -1, "−": -1, _: -1 };

/** spec: EDI-026. The zoom after + or − (a key, or the dialog's buttons): 10 % more or less, within 100–300 %. */
export function zoomStep(zoom: number, key: string): number | null {
  const direction = ZOOM_KEYS[key];
  if (!direction) return null;
  return tidy(clamp(zoom + direction * ZOOM_STEP, MIN_ZOOM, MAX_ZOOM));
}

/** A zone of the 4:3 frame: `left` and `width` in fractions of its width, `top` and `height` of its height. */
export interface FrameZone {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The card the zones are measured on: 448 px wide, so its 4:3 header is 336 px high. */
const CARD_WIDTH = 448;
const HEADER_HEIGHT = 336;
const AVATAR_SIZE = 112;
/** How far the profile photo goes up into the header. */
const AVATAR_OVERLAP = 64;
const PAUSE_SIZE = 44;
const PAUSE_INSET = 12;

/**
 * spec: EDI-026. What the card puts over its header, in fractions of the 4:3 frame: the fade, as high as the
 * header gradient intensity (0 to 100); the profile photo, centred and overlapping the bottom; the pause button
 * of a video, in the top-right corner.
 */
export function coveredZones(headerGradient: number): { fade: FrameZone; avatar: FrameZone; pause: FrameZone } {
  const fade = clamp(headerGradient, 0, 100) / 100;
  return {
    fade: { left: 0, top: tidy(1 - fade), width: 1, height: tidy(fade) },
    avatar: {
      left: (CARD_WIDTH - AVATAR_SIZE) / 2 / CARD_WIDTH,
      top: (HEADER_HEIGHT - AVATAR_OVERLAP) / HEADER_HEIGHT,
      width: AVATAR_SIZE / CARD_WIDTH,
      height: AVATAR_SIZE / HEADER_HEIGHT,
    },
    pause: {
      left: (CARD_WIDTH - PAUSE_INSET - PAUSE_SIZE) / CARD_WIDTH,
      top: PAUSE_INSET / HEADER_HEIGHT,
      width: PAUSE_SIZE / CARD_WIDTH,
      height: PAUSE_SIZE / HEADER_HEIGHT,
    },
  };
}
