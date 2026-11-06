"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { getInitialCropFromCroppedAreaPercentages, type Area, type MediaSize, type Point, type Size } from "react-easy-crop";
import {
  cropFromPercentages,
  isMeasuredArea,
  MAX_ZOOM,
  MIN_ZOOM,
  nudge,
  percentagesFromCrop,
  zoomStep,
  type PercentArea,
} from "@/lib/media/framing";
import type { CropRect } from "@/lib/media/upload";

/** An object URL of `file` for as long as the dialog shows it; the browser releases it afterwards. */
function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    // The object URL is a resource of the browser that this effect owns, from creation to release.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url;
}

/**
 * spec: EDI-026, MED-026, MED-030. The state shared by the crop dialogs: the photo to frame (a file chosen, or the
 * address of a media's source), its position and zoom in the stage, and the crop in proportions of the source that
 * follows from them. Also the keyboard of the stage: arrows move, + and − zoom.
 */
export function useCropFraming(source: File | string, initialCrop: CropRect | null | undefined) {
  const fileUrl = useObjectUrl(typeof source === "string" ? null : source);
  const url = typeof source === "string" ? source : fileUrl;
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [area, setArea] = useState<PercentArea | null>(null);
  const [mediaSize, setMediaSize] = useState<MediaSize | null>(null);
  const [frameSize, setFrameSize] = useState<Size | null>(null);
  const crop = area ? cropFromPercentages(area) : (initialCrop ?? null);

  /** Keeps the areas measured on the loaded media only: the one measured before is not a crop to apply (MED-026). */
  function onAreaChange(next: PercentArea, pixels: Area) {
    if (isMeasuredArea(pixels)) setArea(next);
  }

  function onKey(event: KeyboardEvent) {
    // Ctrl, Cmd and Alt with + or − are the browser's own zoom and shortcuts.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const zoomed = zoomStep(zoom, event.key);
    const moved = zoomed === null && area ? nudge(cropFromPercentages(area), event) : null;
    if (zoomed === null && moved === null) return;
    // The cropper's own arrow handling moves by pixels: these keys are ours.
    event.preventDefault();
    event.stopPropagation();
    if (zoomed !== null) setZoom(zoomed);
    else if (moved && mediaSize && frameSize) {
      const next = getInitialCropFromCroppedAreaPercentages(percentagesFromCrop(moved), mediaSize, 0, frameSize, MIN_ZOOM, MAX_ZOOM);
      setPosition(next.crop);
    }
  }

  function zoomBy(key: "+" | "-") {
    const next = zoomStep(zoom, key);
    if (next !== null) setZoom(next);
  }

  function reset() {
    setPosition({ x: 0, y: 0 });
    setZoom(MIN_ZOOM);
  }

  return {
    url,
    crop,
    position,
    zoom,
    frameSize,
    onKey,
    zoomBy,
    reset,
    setPosition,
    setZoom,
    onAreaChange,
    setMediaSize,
    setFrameSize,
  };
}

export type CropFraming = ReturnType<typeof useCropFraming>;
