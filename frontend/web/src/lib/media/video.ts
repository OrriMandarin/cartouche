import { canvasToJpeg } from "./canvas";
import { frameTimes } from "./framing";

/** How long a video may take to become readable before the upload is given up (MED-021). */
export const VIDEO_LOAD_TIMEOUT_MS = 15_000;

/** The browser neither loaded nor refused the video in time. */
export class VideoLoadTimeout extends Error {
  constructor() {
    super("The video took too long to load.");
    this.name = "VideoLoadTimeout";
  }
}

/**
 * spec: MED-021. Waits for `event` on `video` once `start` has run. Rejects when the video cannot be read, and
 * with `VideoLoadTimeout` when neither `event` nor `error` comes within `timeoutMs`.
 */
async function waitFor(
  video: HTMLVideoElement,
  event: "loadeddata" | "seeked",
  start: () => void,
  timeoutMs = VIDEO_LOAD_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      video.addEventListener(event, () => resolve(), { once: true });
      video.addEventListener("error", () => reject(new Error("The video cannot be read.")), { once: true });
      timer = setTimeout(() => reject(new VideoLoadTimeout()), timeoutMs);
      start();
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * spec: MED-021. A `<video>` outside the page, loaded within the time limit, and the means to release it. A file is
 * read through an object URL; a stored video through its address, asking for CORS so that its frames can be drawn.
 */
async function loadVideo(source: File | string): Promise<{ video: HTMLVideoElement; release: () => void }> {
  const url = typeof source === "string" ? source : URL.createObjectURL(source);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  if (typeof source === "string") video.crossOrigin = "anonymous";
  const release = () => {
    video.removeAttribute("src");
    video.load();
    if (typeof source !== "string") URL.revokeObjectURL(url);
  };
  try {
    await waitFor(video, "loadeddata", () => {
      video.src = url;
    });
  } catch (error) {
    release();
    throw error;
  }
  return { video, release };
}

/** What the editor needs to know of a video before framing it. */
export interface VideoInfo {
  /** In seconds, as the browser reads it (the server reads it again, MED-013). */
  duration: number;
  width: number;
  height: number;
}

/** spec: MED-002, EDI-026. The duration and the size of a video, as the browser reads them. */
export async function readVideoInfo(file: File): Promise<VideoInfo> {
  const { video, release } = await loadVideo(file);
  try {
    return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
  } finally {
    release();
  }
}

/** Seeks `video` to `seconds` (the first frame for a shorter video) and draws that frame, `maxWidth` wide at most. */
async function drawFrame(video: HTMLVideoElement, seconds: number, maxWidth: number): Promise<HTMLCanvasElement> {
  await waitFor(video, "seeked", () => {
    video.currentTime = video.duration > seconds ? seconds : 0;
  });
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No canvas available.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Widest waiting image worth sending: the server never makes one wider than 1 920 px (MED-015). */
const POSTER_MAX_WIDTH = 1920;

/** When the waiting image of an uploaded video is captured, in seconds; sent as its poster time (MED-028). */
export const POSTER_SECONDS = 0.1;

/**
 * spec: MED-003, MED-021, MED-029. A still of the video, as a JPEG, to be shown while the video loads: the whole
 * frame at `atSeconds` (or the first one for a shorter video), drawn in a canvas. Loading and seeking each have the
 * time limit.
 */
export async function capturePoster(source: File | string, atSeconds = POSTER_SECONDS): Promise<Blob> {
  const { video, release } = await loadVideo(source);
  try {
    return await canvasToJpeg(await drawFrame(video, atSeconds, POSTER_MAX_WIDTH));
  } finally {
    release();
  }
}

/** A frame of the strip is drawn twice as wide as it shows, for sharp screens. */
const FRAME_MAX_WIDTH = 240;

/** spec: EDI-034. The `count` frames of the strip of the video dialog, spread evenly over the video, as image addresses. */
export async function captureFrames(source: File | string, count: number): Promise<string[]> {
  const { video, release } = await loadVideo(source);
  try {
    const frames: string[] = [];
    for (const seconds of frameTimes(video.duration, count)) {
      frames.push((await drawFrame(video, seconds, FRAME_MAX_WIDTH)).toDataURL("image/jpeg", 0.7));
    }
    return frames;
  } finally {
    release();
  }
}
