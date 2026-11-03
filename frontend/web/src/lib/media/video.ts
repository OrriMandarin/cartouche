import { canvasToJpeg } from "./canvas";

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

/** spec: MED-021. A `<video>` outside the page, loaded with the file within the time limit, and the means to release it. */
async function loadVideo(file: File): Promise<{ video: HTMLVideoElement; release: () => void }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const release = () => {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
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

/** spec: MED-002. The duration of a video in seconds, as the browser reads it (the server checks it again). */
export async function readVideoDuration(file: File): Promise<number> {
  const { video, release } = await loadVideo(file);
  try {
    return video.duration;
  } finally {
    release();
  }
}

/** Widest waiting image worth sending: the server never makes one wider than 1 920 px (MED-015). */
const POSTER_MAX_WIDTH = 1920;

/**
 * spec: MED-003, MED-021. A still of the video, as a JPEG, to be shown while the video loads: the frame at
 * `atSeconds` (or the first one for a shorter video), drawn in a canvas. Loading and seeking each have the time limit.
 */
export async function capturePoster(file: File, atSeconds = 0.1): Promise<Blob> {
  const { video, release } = await loadVideo(file);
  try {
    await waitFor(video, "seeked", () => {
      video.currentTime = video.duration > atSeconds ? atSeconds : 0;
    });
    const scale = Math.min(1, POSTER_MAX_WIDTH / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas available.");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await canvasToJpeg(canvas);
  } finally {
    release();
  }
}
