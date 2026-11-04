"use client";

import { Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  clampTime,
  formatClock,
  formatSeconds,
  HEADER_RATIO,
  MIN_LOOP_SECONDS,
  setLoopEnd,
  setLoopStart,
  stepTime,
  videoCropStyle,
  wholeLoop,
} from "@/lib/media/framing";
import type { CropRect, VideoLoop } from "@/lib/media/upload";
import { captureFrames, POSTER_SECONDS } from "@/lib/media/video";
import type { ResolvedTheme } from "@/lib/theme/resolve";
import { CropDialogLayout } from "./CropDialogLayout";
import { CardPreview, CoveredZonesSwitch, HeaderFrameOverlay } from "./HeaderCropDialog";
import { useCropFraming } from "./useCropFraming";

/** How many frames the strip shows (EDI-034). */
const STRIP_FRAMES = 8;

/** A header video's framing as the dialog hands it back (MED-028). */
export interface VideoFraming {
  crop: CropRect;
  loop: VideoLoop;
  posterTime: number;
  /** The poster time is the playhead's: its frame must be captured and sent (MED-003). */
  newPoster: boolean;
}

export interface VideoCropDialogProps {
  /** The video to frame: the file chosen, or the address of the media's video when re-framing it (MED-030). */
  video: File | string;
  /** In seconds, as read by the browser for a file, by the server for a stored video. */
  duration: number;
  /** Where re-framing starts (MED-030); without them, the largest centred 4:3 crop and the whole video. */
  initialCrop?: CropRect | null;
  initialLoop?: VideoLoop | null;
  /** The poster time kept unless the owner ticks the box; the playhead starts there. */
  initialPosterTime?: number | null;
  /** The card the preview « Sur ta carte » shows: its theme, its profile photo and its name. */
  theme: ResolvedTheme;
  avatarUrl?: string;
  name?: string | null;
  onApply: (framing: VideoFraming) => void;
  onCancel: () => void;
}

type Drag = "start" | "end" | "playhead";

/**
 * spec: EDI-026, EDI-034, MED-028, MED-030. « Recadrer la vidéo d’en-tête »: the header dialog over the video, with a
 * strip of frames under it. Two handles set the loop (at least a second, MED-028) and show their frame; the playhead
 * picks the frame shown, which the box makes the waiting image. « Lire l’extrait » plays the loop once; nothing
 * plays by itself.
 */
export function VideoCropDialog({
  video,
  duration,
  initialCrop,
  initialLoop,
  initialPosterTime,
  theme,
  avatarUrl,
  name,
  onApply,
  onCancel,
}: VideoCropDialogProps) {
  const t = useTranslations("editor.media.crop");
  const framing = useCropFraming(video, initialCrop);
  const [showZones, setShowZones] = useState(true);
  const [loop, setLoop] = useState<VideoLoop>(initialLoop ?? wholeLoop(duration));
  const keptPosterTime = initialPosterTime ?? POSTER_SECONDS;
  const [playhead, setPlayhead] = useState(initialPosterTime ?? loop.start);
  const [playing, setPlaying] = useState(false);
  const [newPoster, setNewPoster] = useState(false);
  const frames = useStripFrames(video);
  const stageVideo = useRef<RefObject<HTMLVideoElement | null> | null>(null);
  const previewVideo = useRef<HTMLVideoElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const videos = () => [stageVideo.current?.current, previewVideo.current].filter((element) => element != null);

  // Paused, both videos show the frame at the playhead.
  useEffect(() => {
    if (playing) return;
    for (const element of videos()) {
      if (Math.abs(element.currentTime - playhead) > 0.01) element.currentTime = playhead;
    }
  }, [playhead, playing, framing.url]);

  // Playing, the playhead follows the stage video until the loop's end.
  useEffect(() => {
    const element = stageVideo.current?.current;
    if (!playing || !element) return;
    let frame = requestAnimationFrame(function follow() {
      if (element.currentTime >= loop.end || element.ended) {
        for (const each of videos()) each.pause();
        setPlaying(false);
        setPlayhead(loop.end);
        return;
      }
      setPlayhead(element.currentTime);
      frame = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, loop.end]);

  function seek(seconds: number) {
    for (const element of videos()) element.pause();
    setPlaying(false);
    setPlayhead(clampTime(seconds, duration));
  }

  function play() {
    const all = videos();
    if (all.length === 0) return;
    for (const element of all) {
      element.currentTime = loop.start;
      element.play().catch(() => setPlaying(false));
    }
    setPlayhead(loop.start);
    setPlaying(true);
  }

  function moveHandle(handle: "start" | "end", seconds: number) {
    const next = handle === "start" ? setLoopStart(loop, seconds, duration) : setLoopEnd(loop, seconds, duration);
    setLoop(next);
    seek(next[handle]);
  }

  function move(target: Drag, seconds: number) {
    if (target === "playhead") seek(seconds);
    else moveHandle(target, seconds);
  }

  function onKey(target: Drag, value: number) {
    return (event: KeyboardEvent) => {
      const step = stepTime(event);
      if (step === null) return;
      event.preventDefault();
      move(target, value + step);
    };
  }

  /** The time under the pointer, from the strip's left edge (0) to its right edge (the duration). */
  function timeAt(clientX: number): number {
    const box = strip.current?.getBoundingClientRect();
    if (!box || box.width === 0) return 0;
    return ((clientX - box.left) / box.width) * duration;
  }

  function startDrag(target: Drag) {
    return (event: PointerEvent) => {
      event.stopPropagation();
      drag.current = target;
      strip.current?.setPointerCapture?.(event.pointerId);
      move(target, timeAt(event.clientX));
    };
  }

  const percent = (seconds: number) => `${(seconds / duration) * 100}%`;
  const valueText = (seconds: number) => t("video.seconds", { s: formatSeconds(seconds) });
  const playheadClock = formatClock(playhead);

  return (
    <CropDialogLayout
      framing={framing}
      initialCrop={initialCrop}
      aspect={HEADER_RATIO}
      video
      setVideoRef={(ref) => {
        stageVideo.current = ref;
      }}
      title={
        <>
          <span className="max-[847px]:hidden">{t("video.title")}</span>
          <span className="min-[848px]:hidden">{t("video.titlePhone")}</span>
        </>
      }
      stageLabel={t("video.stage")}
      phoneHint={t("header.phoneHint")}
      testId="video-crop-dialog"
      applyTestId="video-crop-apply"
      onApply={(crop) =>
        onApply({ crop, loop, posterTime: newPoster ? clampTime(playhead, duration) : keptPosterTime, newPoster })
      }
      onCancel={onCancel}
      frameOverlay={<HeaderFrameOverlay theme={theme} showZones={showZones} />}
      belowStage={
        <div className="flex flex-col gap-3 max-[847px]:bg-app-surface max-[847px]:px-4 max-[847px]:pt-4">
          <div className="flex items-center gap-2.5 max-[847px]:gap-2">
            <Button type="button" variant="secondary" size="icon" aria-label={t("video.play")} onClick={play}>
              <Play aria-hidden="true" />
            </Button>
            <div
              ref={strip}
              role="group"
              aria-label={t("video.strip")}
              data-testid="video-crop-strip"
              className="relative h-14 flex-1 touch-none select-none max-[847px]:h-[52px]"
              onPointerDown={startDrag("playhead")}
              onPointerMove={(event) => drag.current && move(drag.current, timeAt(event.clientX))}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
            >
              <div aria-hidden="true" className="bg-app-stage absolute inset-0 flex overflow-hidden rounded-lg">
                {frames.map((frame, index) => (
                  // eslint-disable-next-line @next/next/no-img-element -- frames drawn by the browser
                  <img key={index} data-testid="video-crop-frame" src={frame} alt="" className="block h-full min-w-0 flex-1 object-cover" />
                ))}
                <div className="absolute inset-y-0 left-0 bg-black/60" style={{ width: percent(loop.start) }} />
                <div className="absolute inset-y-0 right-0 bg-black/60" style={{ width: `${100 - (loop.end / duration) * 100}%` }} />
                <div
                  className="border-app-on-stage absolute inset-y-0 rounded-lg border-[3px]"
                  style={{ left: percent(loop.start), right: `${100 - (loop.end / duration) * 100}%` }}
                />
              </div>
              <Handle
                label={t("video.start")}
                value={loop.start}
                min={0}
                max={Math.max(0, loop.end - MIN_LOOP_SECONDS)}
                valueText={valueText(loop.start)}
                barLeft={percent(loop.start)}
                onKeyDown={onKey("start", loop.start)}
                onPointerDown={startDrag("start")}
              />
              <Handle
                label={t("video.end")}
                value={loop.end}
                min={Math.min(duration, loop.start + MIN_LOOP_SECONDS)}
                max={duration}
                valueText={valueText(loop.end)}
                barLeft={`calc(${percent(loop.end)} - 16px)`}
                onKeyDown={onKey("end", loop.end)}
                onPointerDown={startDrag("end")}
              />
              <span
                role="slider"
                tabIndex={0}
                aria-label={t("video.playhead")}
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={playhead}
                aria-valuetext={valueText(playhead)}
                onKeyDown={onKey("playhead", playhead)}
                className="pointer-events-none absolute -inset-y-1 z-20 w-0.5 -translate-x-1/2 bg-[#FFD54A] shadow-[0_0_0_1px_rgb(0_0_0/.4)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-ring)]"
                style={{ left: percent(playhead) }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2.5 text-[13px]">
            <span className="font-app-mono">{formatClock(loop.start)}</span>
            <span>
              <b>{t("video.loop", { d: formatSeconds(loop.end - loop.start) })}</b>
              <span className="max-[847px]:hidden">
                {" · "}
                <span className="text-app-muted">{t("video.playheadAt", { t: playheadClock })}</span>
              </span>
            </span>
            <span className="font-app-mono">{formatClock(loop.end)}</span>
          </div>
        </div>
      }
      preview={
        <CardPreview theme={theme} avatarUrl={avatarUrl} name={name}>
          {framing.url ? (
            <video
              ref={previewVideo}
              src={framing.url}
              muted
              playsInline
              preload="auto"
              aria-hidden="true"
              className="block"
              style={videoCropStyle(framing.crop)}
            />
          ) : null}
        </CardPreview>
      }
      afterZoom={
        <>
          <label className="flex min-h-11 items-center gap-2.5 text-sm leading-[1.4]">
            <input
              type="checkbox"
              data-testid="video-crop-poster"
              className="accent-app-primary size-5 flex-none"
              checked={newPoster}
              onChange={(event) => setNewPoster(event.target.checked)}
            />
            <span className="max-[847px]:hidden">{t("video.poster", { t: playheadClock })}</span>
            <span className="min-[848px]:hidden">{t("video.posterPhone")}</span>
          </label>
          <CoveredZonesSwitch showZones={showZones} onChange={setShowZones} />
        </>
      }
    />
  );
}

/**
 * spec: EDI-034. A loop handle of the strip: a 16 px bar the owner drags, in a 44 px touch area, moved by the
 * arrows (a tenth of a second, a second with Shift).
 */
function Handle({
  label,
  value,
  min,
  max,
  valueText,
  barLeft,
  onKeyDown,
  onPointerDown,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  valueText: string;
  /** Where the visible bar starts. */
  barLeft: string;
  onKeyDown: (event: KeyboardEvent) => void;
  onPointerDown: (event: PointerEvent) => void;
}) {
  return (
    <span
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      className="group absolute inset-y-0 z-10 w-11 cursor-ew-resize outline-none"
      style={{ left: `calc(${barLeft} - 14px)` }}
    >
      <span
        aria-hidden="true"
        className="bg-app-on-stage absolute inset-y-0 left-[14px] grid w-4 place-items-center rounded-[4px] shadow-[0_1px_3px_rgb(0_0_0/.45)] group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-[var(--app-ring)]"
      >
        <span className="bg-app-text h-[18px] w-0.5 rounded-[2px]" />
      </span>
    </span>
  );
}

/** spec: EDI-034. The frames of the strip, once the browser has drawn them; none while it does, or if it cannot. */
function useStripFrames(video: File | string): string[] {
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => {
    let current = true;
    captureFrames(video, STRIP_FRAMES)
      .then((drawn) => current && setFrames(drawn))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [video]);
  return frames;
}
