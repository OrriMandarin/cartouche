import { type RefObject, useEffect, useState } from "react";

export type MediaLoadState = "loading" | "loaded" | "failed";

/** `HTMLMediaElement.HAVE_FUTURE_DATA` and `NETWORK_NO_SOURCE`, spelled out because jsdom lacks the constants. */
const HAVE_FUTURE_DATA = 3;
const NETWORK_NO_SOURCE = 3;

/** What the element already says about itself: a load can finish, or fail, before React attaches its listeners. */
function currentState(el: HTMLImageElement | HTMLVideoElement, kind: "image" | "video"): MediaLoadState {
  if (kind === "image") {
    const image = el as HTMLImageElement;
    if (!image.complete) return "loading";
    return image.naturalWidth > 0 ? "loaded" : "failed";
  }
  const video = el as HTMLVideoElement;
  if (Boolean(video.error) || video.networkState === NETWORK_NO_SOURCE) return "failed";
  return video.readyState >= HAVE_FUTURE_DATA ? "loaded" : "loading";
}

/**
 * The load state of a media element (PUB-006, PUB-039, PUB-040, PUB-041). It starts as "loading" on the server and
 * on the first render, listens to the element's events, and reads the element once on mount so that a load that
 * finished or failed before hydration leaves the loading state.
 */
export function useMediaLoad(
  ref: RefObject<HTMLImageElement | HTMLVideoElement | null>,
  kind: "image" | "video",
): MediaLoadState {
  const [state, setState] = useState<MediaLoadState>("loading");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const loaded = () => setState("loaded");
    const failed = () => setState("failed");
    const loadedEvents = kind === "image" ? ["load"] : ["canplay", "playing"];
    for (const name of loadedEvents) el.addEventListener(name, loaded);
    el.addEventListener("error", failed);
    setState(currentState(el, kind));
    return () => {
      for (const name of loadedEvents) el.removeEventListener(name, loaded);
      el.removeEventListener("error", failed);
    };
  }, [ref, kind]);

  return state;
}
