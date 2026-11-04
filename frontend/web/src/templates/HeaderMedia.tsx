"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { loopRestart, videoCropStyle } from "@/lib/media/framing";
import { TEMPLATE_TEST_IDS as TEST_IDS, type MediaView } from "./contract";

export interface HeaderMediaLabels {
  pause: string;
  play: string;
}

interface HeaderMediaProps {
  media: MediaView | null | undefined;
  labels: HeaderMediaLabels;
  /** Whether the visitor asks for less motion; injected by tests. */
  reducedMotion?: () => boolean;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  return window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;
}

function watchReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

function srcSet(media: MediaView): string {
  return media.images.map((image) => `${image.url} ${image.width}w`).join(", ");
}

function EmptyBand() {
  return <div className="cc-media is-empty" data-testid={TEST_IDS.headerEmpty} aria-hidden="true" />;
}

/**
 * The header video, cropped and looped at display time from its stored framing (MED-032): muted (PUB-005), with
 * its waiting image blurred under a shimmer until it can play (PUB-006), and a button to pause it (PUB-031).
 * Under reduced motion it does not start by itself (PUB-038).
 */
function HeaderVideo({
  media,
  labels,
  reducedMotion,
}: { media: MediaView; labels: HeaderMediaLabels } & Pick<HeaderMediaProps, "reducedMotion">) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  // Null until the visitor, or the video, says otherwise: it then follows the motion preference.
  const [playingState, setPlaying] = useState<boolean | null>(null);
  const reduced = useSyncExternalStore(watchReducedMotion, reducedMotion ?? prefersReducedMotion, () => false);
  const playing = playingState ?? !reduced;
  const poster = media.images.at(-1)?.url;
  const loop = media.loop ?? null;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = true;
    if (loop) el.currentTime = loop.start;
    if ((reducedMotion ?? prefersReducedMotion)()) return;
    start(el);
    // Played once on mount: the framing of a media does not change under the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // jsdom's play() returns undefined and a browser may refuse an autoplay: neither is an error, but a refused
  // play leaves the video paused and the button must say so.
  function start(el: HTMLVideoElement) {
    Promise.resolve(el.play()).catch(() => setPlaying(false));
  }

  // At the end of the file the browser pauses and a seek does not resume it: loop by hand (MED-032, MED-033).
  function onEnded() {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = loop?.start ?? 0;
    setPlaying(true);
    start(el);
  }

  function onTimeUpdate() {
    const el = videoRef.current;
    if (!el) return;
    const target = loopRestart(el.currentTime, loop, el.duration);
    if (target !== null) el.currentTime = target;
  }

  function toggle() {
    const el = videoRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      setPlaying(true);
      start(el);
    }
  }

  const loading = !ready;
  const showPoster = poster !== undefined && loading;
  return (
    <div className={loading ? "cc-media is-loading" : "cc-media"} aria-busy={loading}>
      {showPoster && (
        // A plain img, like the header image below.
        // eslint-disable-next-line @next/next/no-img-element
        <img className={loading && !reduced ? "cc-media-el is-blur" : "cc-media-el"} src={poster} alt="" />
      )}
      {loading && !reduced && <div className="cc-shimmer" aria-hidden="true" />}
      <video
        ref={videoRef}
        data-testid={TEST_IDS.headerVideo}
        src={media.video_url ?? undefined}
        poster={poster}
        playsInline
        preload="auto"
        aria-hidden="true"
        style={videoCropStyle(media.crop)}
        onTimeUpdate={onTimeUpdate}
        onCanPlay={() => setReady(true)}
        onEnded={onEnded}
        onPlaying={() => {
          setReady(true);
          setPlaying(true);
        }}
        // The pause that precedes `ended` is not the visitor's.
        onPause={(event) => setPlaying(event.currentTarget.ended)}
      />
      <button
        type="button"
        className="cc-pause"
        data-testid="header-video-toggle"
        aria-label={playing ? labels.pause : labels.play}
        onClick={toggle}
      >
        {playing ? <Pause className="ic" aria-hidden="true" /> : <Play className="ic" aria-hidden="true" />}
      </button>
    </div>
  );
}

/** The header image or video; without media, a short band tinted with the accent (PUB-004, PUB-023). */
export function HeaderMedia({ media, labels, reducedMotion }: HeaderMediaProps) {
  if (media?.kind === "video" && media.video_url) {
    return <HeaderVideo media={media} labels={labels} reducedMotion={reducedMotion} />;
  }
  const src = media?.images.at(-1)?.url;
  if (!media || !src) return <EmptyBand />;
  return (
    <div className="cc-media">
      {/* A plain img: media URLs are absolute and external, and next/image would add an optimizer hop. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="cc-media-el"
        data-testid={TEST_IDS.headerImage}
        src={src}
        srcSet={srcSet(media)}
        sizes="(min-width: 40rem) 28rem, 100vw"
        alt=""
      />
    </div>
  );
}
