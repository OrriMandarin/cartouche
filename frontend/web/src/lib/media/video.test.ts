import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { capturePoster, readVideoDuration, VIDEO_LOAD_TIMEOUT_MS, VideoLoadTimeout } from "./video";

const revokeObjectURL = vi.fn();
let element: HTMLVideoElement;

beforeEach(() => {
  vi.useFakeTimers();
  revokeObjectURL.mockReset();
  vi.stubGlobal("URL", { createObjectURL: () => "blob:video", revokeObjectURL });
  // A `<video>` that never loads on its own: the test fires its events.
  element = document.createElement("video");
  Object.defineProperty(element, "load", { value: () => {} });
  Object.defineProperty(element, "duration", { value: 7.5 });
  vi.spyOn(document, "createElement").mockReturnValue(element);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mp4 = () => new File(["mp4"], "clip.mp4", { type: "video/mp4" });

describe("video", () => {
  test("MED-021 loading a video gives up after 15 seconds", async () => {
    const outcome = readVideoDuration(mp4()).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(VIDEO_LOAD_TIMEOUT_MS - 1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(await outcome).toBeInstanceOf(VideoLoadTimeout);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:video");
  });

  test("MED-021 a video that loads in time is read", async () => {
    const outcome = readVideoDuration(mp4());

    await vi.advanceTimersByTimeAsync(VIDEO_LOAD_TIMEOUT_MS - 1);
    element.dispatchEvent(new Event("loadeddata"));

    expect(await outcome).toBe(7.5);
    // Released once read, and the timer no longer fires.
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(VIDEO_LOAD_TIMEOUT_MS);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  test("MED-021 capturing the waiting image gives up when seeking takes over 15 seconds", async () => {
    const outcome = capturePoster(mp4()).catch((error: unknown) => error);
    element.dispatchEvent(new Event("loadeddata"));

    await vi.advanceTimersByTimeAsync(VIDEO_LOAD_TIMEOUT_MS - 1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(await outcome).toBeInstanceOf(VideoLoadTimeout);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
