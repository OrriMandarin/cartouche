import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { captureFrames, capturePoster, readVideoInfo, VIDEO_LOAD_TIMEOUT_MS, VideoLoadTimeout } from "./video";

const revokeObjectURL = vi.fn();
let element: HTMLVideoElement;
let seeks: number[];
let answerSeeks: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  revokeObjectURL.mockReset();
  vi.stubGlobal("URL", { createObjectURL: () => "blob:video", revokeObjectURL });
  // A `<video>` that never loads on its own: the test fires its events.
  element = document.createElement("video");
  Object.defineProperty(element, "load", { value: () => {} });
  Object.defineProperty(element, "duration", { value: 7.5 });
  Object.defineProperty(element, "videoWidth", { value: 640 });
  Object.defineProperty(element, "videoHeight", { value: 360 });
  // Every seek is answered at once, at the time asked.
  seeks = [];
  answerSeeks = true;
  Object.defineProperty(element, "currentTime", {
    set: (time: number) => {
      seeks.push(time);
      if (answerSeeks) queueMicrotask(() => element.dispatchEvent(new Event("seeked")));
    },
  });
  const realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag !== "canvas") return element;
    const canvas = realCreateElement("canvas");
    Object.defineProperty(canvas, "getContext", { value: () => ({ drawImage: vi.fn() }) });
    Object.defineProperty(canvas, "toDataURL", { value: () => `data:image/jpeg;base64,frame${seeks.length}` });
    Object.defineProperty(canvas, "toBlob", { value: (done: BlobCallback) => done(new Blob([`frame${seeks.length}`])) });
    return canvas;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mp4 = () => new File(["mp4"], "clip.mp4", { type: "video/mp4" });

describe("video", () => {
  test("MED-021 loading a video gives up after 15 seconds", async () => {
    const outcome = readVideoInfo(mp4()).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(VIDEO_LOAD_TIMEOUT_MS - 1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(await outcome).toBeInstanceOf(VideoLoadTimeout);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:video");
  });

  test("MED-021 a video that loads in time is read", async () => {
    const outcome = readVideoInfo(mp4());

    await vi.advanceTimersByTimeAsync(VIDEO_LOAD_TIMEOUT_MS - 1);
    element.dispatchEvent(new Event("loadeddata"));

    expect(await outcome).toEqual({ duration: 7.5, width: 640, height: 360 });
    // Released once read, and the timer no longer fires.
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(VIDEO_LOAD_TIMEOUT_MS);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  test("MED-021 capturing the waiting image gives up when seeking takes over 15 seconds", async () => {
    answerSeeks = false;
    const outcome = capturePoster(mp4()).catch((error: unknown) => error);
    element.dispatchEvent(new Event("loadeddata"));

    await vi.advanceTimersByTimeAsync(VIDEO_LOAD_TIMEOUT_MS - 1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(await outcome).toBeInstanceOf(VideoLoadTimeout);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  test("EDI-034 the strip takes its frames spread evenly over the video", async () => {
    const outcome = captureFrames(mp4(), 4);
    element.dispatchEvent(new Event("loadeddata"));

    expect(await outcome).toEqual([1, 2, 3, 4].map((n) => `data:image/jpeg;base64,frame${n}`));
    expect(seeks).toEqual([0.9375, 2.8125, 4.6875, 6.5625]);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:video");
  });

  test("MED-003 EDI-034 a frame of a stored video is captured at the time asked, read across origins", async () => {
    const outcome = capturePoster("https://media.example.test/video.mp4", 2.9);
    expect(element.crossOrigin).toBe("anonymous");
    expect(element.src).toBe("https://media.example.test/video.mp4");
    element.dispatchEvent(new Event("loadeddata"));

    expect(await (await outcome).text()).toBe("frame1");
    expect(seeks).toEqual([2.9]);
    // The address is the stored video's: nothing to release.
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});
