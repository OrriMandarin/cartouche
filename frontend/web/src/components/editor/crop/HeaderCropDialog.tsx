"use client";

import { Check, Minus, Plus, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type KeyboardEvent } from "react";
import Cropper, { getInitialCropFromCroppedAreaPercentages, type MediaSize, type Point, type Size } from "react-easy-crop";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  cropFromPercentages,
  HEADER_RATIO,
  MAX_ZOOM,
  MIN_ZOOM,
  nudge,
  percentagesFromCrop,
  videoCropStyle,
  zoomStep,
  type PercentArea,
} from "@/lib/media/framing";
import type { CropRect } from "@/lib/media/upload";
import { themeToCssVars } from "@/lib/theme/css-vars";
import type { ResolvedTheme } from "@/lib/theme/resolve";
import { CoveredZones } from "./CoveredZones";

export interface HeaderCropDialogProps {
  /** The photo to frame: the file chosen, or the address of a media's source when re-framing it (MED-030). */
  source: File | string;
  /** Where re-framing starts (MED-030); without it, the largest centred 4:3 rectangle (MED-026). */
  initialCrop?: CropRect | null;
  /** The card the preview « Sur ta carte » shows: its theme, its profile photo and its name. */
  theme: ResolvedTheme;
  avatarUrl?: string;
  name?: string | null;
  onApply: (crop: CropRect) => void;
  onCancel: () => void;
}

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
 * spec: EDI-026, MED-026, MED-030. « Recadrer l’en-tête »: a fixed 4:3 frame over a rule-of-thirds grid, in which
 * the owner moves and zooms the photo (100 to 300 %) with the pointer, a pinch, the arrows and + / −. The zones the
 * card covers are drawn dotted and can be hidden; « Sur ta carte » previews the result; « Réinitialiser » returns to
 * the default crop and « Appliquer » hands back the crop in proportions of the source. Full screen on a phone.
 */
export function HeaderCropDialog({ source, initialCrop, theme, avatarUrl, name, onApply, onCancel }: HeaderCropDialogProps) {
  const t = useTranslations("editor.media.crop");
  const fileUrl = useObjectUrl(typeof source === "string" ? null : source);
  const url = typeof source === "string" ? source : fileUrl;
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [area, setArea] = useState<PercentArea | null>(null);
  const [mediaSize, setMediaSize] = useState<MediaSize | null>(null);
  const [frameSize, setFrameSize] = useState<Size | null>(null);
  const [showZones, setShowZones] = useState(true);
  const crop = area ? cropFromPercentages(area) : (initialCrop ?? null);
  const zoomPercent = Math.round(zoom * 100);
  const fadeTo = theme.background.kind === "solid" ? theme.background.color : theme.background.to;

  function onKey(event: KeyboardEvent) {
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

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        data-testid="header-crop-dialog"
        closeLabel={t("close")}
        aria-describedby={undefined}
        className="max-h-[calc(100dvh-2rem)] grid-cols-[1fr_auto_auto] gap-x-2.5 gap-y-5 overflow-y-auto sm:max-w-[1080px] max-[847px]:inset-0 max-[847px]:h-dvh max-[847px]:max-h-none max-[847px]:max-w-none max-[847px]:translate-x-0 max-[847px]:translate-y-0 max-[847px]:grid-cols-[auto_1fr_auto] max-[847px]:grid-rows-[56px_1fr] max-[847px]:gap-0 max-[847px]:rounded-none max-[847px]:p-0 max-[847px]:[&>button:last-child]:hidden"
      >
        <div aria-hidden="true" className="bg-app-stage col-[1/4] row-[1] hidden max-[847px]:block" />
        <DialogTitle
          className="col-[1/4] row-[1] pr-12 max-[847px]:text-app-on-stage max-[847px]:col-[2/3] max-[847px]:self-center max-[847px]:pr-0 max-[847px]:text-center max-[847px]:text-base max-[847px]:font-bold"
        >
          {t("header.title")}
        </DialogTitle>

        <div className="col-[1/4] row-[2] grid gap-6 min-[848px]:grid-cols-[minmax(0,680px)_minmax(0,1fr)] max-[847px]:flex max-[847px]:min-h-0 max-[847px]:flex-col max-[847px]:gap-0">
          <div
            role="application"
            aria-label={t("header.stage")}
            tabIndex={0}
            onKeyDownCapture={onKey}
            className="bg-app-stage relative aspect-[680/500] w-full touch-none overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-ring)] max-[847px]:aspect-auto max-[847px]:min-h-64 max-[847px]:flex-1 max-[847px]:rounded-none"
          >
            {url ? (
              <Cropper
                image={url}
                crop={position}
                zoom={zoom}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
                aspect={HEADER_RATIO}
                showGrid
                initialCroppedAreaPercentages={initialCrop ? percentagesFromCrop(initialCrop) : undefined}
                onCropChange={setPosition}
                onZoomChange={setZoom}
                onCropAreaChange={setArea}
                onCropComplete={setArea}
                onCropSizeChange={setFrameSize}
                onMediaLoaded={setMediaSize}
                cropperProps={{ tabIndex: -1 }}
                style={{
                  containerStyle: { background: "var(--app-stage)" },
                  cropAreaStyle: { border: "2px solid var(--app-on-stage)", color: "var(--app-stage-dim)" },
                }}
              />
            ) : null}
            {frameSize ? (
              <div
                className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ width: frameSize.width, height: frameSize.height }}
              >
                {showZones ? <CoveredZones headerGradient={theme.headerGradient} fadeTo={fadeTo} /> : null}
                {["-top-2 -left-2", "-top-2 -right-2", "-bottom-2 -left-2", "-bottom-2 -right-2"].map((corner) => (
                  <span
                    key={corner}
                    aria-hidden="true"
                    className={`bg-app-on-stage absolute size-4 rounded-[4px] shadow-[0_1px_3px_rgb(0_0_0/.45)] ${corner}`}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-[18px] max-[847px]:bg-app-surface max-[847px]:gap-3 max-[847px]:p-4">
            <p className="text-app-muted text-center text-[13px] leading-[1.4] min-[848px]:hidden">{t("header.phoneHint")}</p>
            <section className="flex flex-col gap-2.5 max-[847px]:hidden" aria-labelledby="header-crop-preview">
              <h3 id="header-crop-preview" className="text-[15px] leading-[1.35] font-[650]">
                {t("header.preview")}
              </h3>
              <CardPreview url={url} crop={crop} theme={theme} avatarUrl={avatarUrl} name={name} />
            </section>
            <div className="flex flex-col gap-0.5">
              <span className="text-[15px] leading-[1.35] font-[650] max-[847px]:hidden">{t("zoom")}</span>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon" aria-label={t("zoomOut")} disabled={zoom <= MIN_ZOOM} onClick={() => zoomBy("-")}>
                  <Minus aria-hidden="true" />
                </Button>
                <Slider
                  aria-label={t("zoom")}
                  aria-valuetext={t("zoomValue", { n: zoomPercent })}
                  min={MIN_ZOOM * 100}
                  max={MAX_ZOOM * 100}
                  step={1}
                  value={[zoomPercent]}
                  onValueChange={([next]) => next !== undefined && setZoom(next / 100)}
                />
                <Button type="button" variant="ghost" size="icon" aria-label={t("zoomIn")} disabled={zoom >= MAX_ZOOM} onClick={() => zoomBy("+")}>
                  <Plus aria-hidden="true" />
                </Button>
              </div>
            </div>
            <div className="flex min-h-11 items-center gap-3 max-[847px]:flex-row-reverse max-[847px]:justify-between">
              <Switch id="header-crop-zones" checked={showZones} onCheckedChange={setShowZones} />
              <Label htmlFor="header-crop-zones" className="text-sm font-semibold">
                {t("showZones")}
              </Label>
            </div>
            {showZones ? (
              <ul className="text-app-muted flex flex-col gap-1.5 text-[13px] max-[847px]:hidden">
                <li className="flex items-center gap-2">
                  <i aria-hidden="true" className="border-app-border-strong inline-block h-3 w-[18px] rounded-[3px] border-2 border-dashed" />
                  {t("header.legendFade")}
                </li>
                <li className="flex items-center gap-2">
                  <i aria-hidden="true" className="border-app-border-strong inline-block size-3.5 rounded-full border-2 border-dashed" />
                  {t("header.legendRound")}
                </li>
              </ul>
            ) : null}
            <Button type="button" variant="ghost" className="self-start px-2 max-[847px]:self-center" onClick={reset}>
              <RotateCcw aria-hidden="true" />
              {t("reset")}
            </Button>
          </div>
        </div>

        <Button
          type="button"
          variant="secondary"
          className="col-[2/3] row-[3] max-[847px]:text-app-on-stage max-[847px]:col-[1/2] max-[847px]:row-[1] max-[847px]:self-center max-[847px]:border-0 max-[847px]:bg-transparent max-[847px]:shadow-none"
          onClick={onCancel}
        >
          {t("cancel")}
        </Button>
        <Button
          type="button"
          data-testid="header-crop-apply"
          disabled={!crop}
          className="col-[3/4] row-[3] max-[847px]:text-app-on-stage max-[847px]:col-[3/4] max-[847px]:row-[1] max-[847px]:self-center max-[847px]:bg-transparent max-[847px]:font-bold max-[847px]:[&_svg]:hidden"
          onClick={() => crop && onApply(crop)}
        >
          <Check aria-hidden="true" />
          {t("apply")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/** spec: EDI-026. « Sur ta carte »: the top of the card with the header cut along the crop and its fade. */
function CardPreview({
  url,
  crop,
  theme,
  avatarUrl,
  name,
}: {
  url: string | null;
  crop: CropRect | null;
  theme: ResolvedTheme;
  avatarUrl?: string;
  name?: string | null;
}) {
  const fade = "linear-gradient(to bottom, #000 calc(100% - var(--fade) * 1%), transparent 100%)";
  return (
    <div
      data-testid="header-crop-preview"
      className="w-[272px] max-w-full overflow-hidden rounded-2xl shadow-[0_0_0_1px_rgb(28_27_25/.12)]"
      style={{ ...themeToCssVars(theme), background: "linear-gradient(var(--bg-angle), var(--c-bg), var(--c-bg-2))" }}
    >
      <div className="relative aspect-[4/3] overflow-hidden" style={{ maskImage: fade, WebkitMaskImage: fade }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- an object URL or a signed media URL */}
        {url ? <img src={url} alt="" className="block" style={videoCropStyle(crop)} /> : null}
      </div>
      {avatarUrl ? (
        <div className="relative mx-auto -mt-[46px] size-[82px] overflow-hidden rounded-full shadow-[0_0_0_3px_var(--c-bg)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- media URLs are absolute and external */}
          <img src={avatarUrl} alt="" className="block size-full object-cover" />
        </div>
      ) : null}
      {name ? (
        <p
          className="px-3 pt-2 pb-4 text-center text-xl font-semibold"
          style={{ fontFamily: "var(--font-title)", color: "var(--c-text)" }}
        >
          {name}
        </p>
      ) : null}
    </div>
  );
}
