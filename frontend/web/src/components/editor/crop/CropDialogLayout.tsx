"use client";

import { Check, Minus, Plus, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, type ReactNode, type RefObject } from "react";
import Cropper from "react-easy-crop";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { MAX_ZOOM, MIN_ZOOM, percentagesFromCrop } from "@/lib/media/framing";
import type { CropRect } from "@/lib/media/upload";
import type { CropFraming } from "./useCropFraming";

interface CropDialogLayoutProps {
  framing: CropFraming;
  initialCrop?: CropRect | null;
  /** Shape of the frame: 4:3 for the header, 1 for the profile photo. */
  aspect: number;
  /** A round mask over a square frame (the profile photo). */
  round?: boolean;
  /** Frames a video rather than a photo (EDI-034): the stage plays it, paused until the owner plays it. */
  video?: boolean;
  /** The stage's video element, to seek and play it (EDI-034). */
  setVideoRef?: (ref: RefObject<HTMLVideoElement | null>) => void;
  title: ReactNode;
  stageLabel: string;
  phoneHint: string;
  testId: string;
  applyTestId: string;
  /** Drawn over the frame, in a box of its size (the header's covered zones and handles). */
  frameOverlay?: ReactNode;
  /** The side panel above the zoom (the preview). */
  preview: ReactNode;
  /** Under the stage (the video's strip of frames). */
  belowStage?: ReactNode;
  /** The side panel between the zoom and « Réinitialiser ». */
  afterZoom?: ReactNode;
  onApply: (crop: CropRect) => void;
  onCancel: () => void;
}

/**
 * spec: EDI-026, EDI-035. What the header and profile photo crop dialogs share: the stage where the owner moves
 * and zooms the photo (pointer, pinch, arrows, + and −), the zoom control from 100 to 300 %, « Réinitialiser »,
 * « Annuler » and « Appliquer ». The stage takes the focus as the dialog opens. Full screen on a phone.
 */
export function CropDialogLayout({
  framing,
  initialCrop,
  aspect,
  round,
  video,
  setVideoRef,
  title,
  stageLabel,
  phoneHint,
  testId,
  applyTestId,
  frameOverlay,
  preview,
  belowStage,
  afterZoom,
  onApply,
  onCancel,
}: CropDialogLayoutProps) {
  const t = useTranslations("editor.media.crop");
  const stage = useRef<HTMLDivElement>(null);
  const { url, crop, position, zoom, frameSize } = framing;
  const zoomPercent = Math.round(zoom * 100);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        data-testid={testId}
        closeLabel={t("close")}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          stage.current?.focus();
        }}
        className="max-h-[calc(100dvh-2rem)] grid-cols-[1fr_auto_auto] gap-x-2.5 gap-y-5 overflow-y-auto sm:max-w-[1080px] max-[847px]:inset-0 max-[847px]:h-dvh max-[847px]:max-h-none max-[847px]:max-w-none max-[847px]:translate-x-0 max-[847px]:translate-y-0 max-[847px]:grid-cols-[auto_1fr_auto] max-[847px]:grid-rows-[56px_1fr] max-[847px]:gap-0 max-[847px]:rounded-none max-[847px]:p-0 max-[847px]:[&>button:last-child]:hidden"
      >
        <div aria-hidden="true" className="bg-app-stage col-[1/4] row-[1] hidden max-[847px]:block" />
        <DialogTitle
          className="col-[1/4] row-[1] pr-12 max-[847px]:text-app-on-stage max-[847px]:col-[2/3] max-[847px]:self-center max-[847px]:pr-0 max-[847px]:text-center max-[847px]:text-base max-[847px]:font-bold"
        >
          {title}
        </DialogTitle>

        <div className="col-[1/4] row-[2] grid gap-6 min-[848px]:grid-cols-[minmax(0,680px)_minmax(0,1fr)] max-[847px]:flex max-[847px]:min-h-0 max-[847px]:flex-col max-[847px]:gap-0">
          <div className="flex min-w-0 flex-col gap-3 max-[847px]:min-h-0 max-[847px]:flex-1 max-[847px]:gap-0">
            <div
              ref={stage}
              role="application"
              aria-label={stageLabel}
              tabIndex={0}
              onKeyDownCapture={framing.onKey}
              className="bg-app-stage relative aspect-[680/500] w-full touch-none overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-ring)] max-[847px]:aspect-auto max-[847px]:min-h-64 max-[847px]:flex-1 max-[847px]:rounded-none"
            >
              {url ? (
                <Cropper
                  {...(video
                    ? {
                        video: url,
                        // Paused on its first frame: the owner plays the extract (EDI-034). Asked for across origins like
                        // the strip's frames, so that the browser never reuses a response it cannot draw (MED-045).
                        mediaProps: {
                          autoPlay: false,
                          loop: false,
                          muted: true,
                          playsInline: true,
                          preload: "auto",
                          crossOrigin: "anonymous",
                        },
                        setVideoRef,
                      }
                    : { image: url })}
                  crop={position}
                  zoom={zoom}
                  minZoom={MIN_ZOOM}
                  maxZoom={MAX_ZOOM}
                  aspect={aspect}
                  cropShape={round ? "round" : "rect"}
                  showGrid={!round}
                  initialCroppedAreaPercentages={initialCrop ? percentagesFromCrop(initialCrop) : undefined}
                  onCropChange={framing.setPosition}
                  onZoomChange={framing.setZoom}
                  onCropAreaChange={framing.onAreaChange}
                  onCropComplete={framing.onAreaChange}
                  onCropSizeChange={framing.setFrameSize}
                  onMediaLoaded={framing.setMediaSize}
                  cropperProps={{ tabIndex: -1 }}
                  style={{
                    containerStyle: { background: "var(--app-stage)" },
                    cropAreaStyle: { border: "2px solid var(--app-on-stage)", color: "var(--app-stage-dim)" },
                  }}
                />
              ) : null}
              {frameSize && frameOverlay ? (
                <div
                  className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                  style={{ width: frameSize.width, height: frameSize.height }}
                >
                  {frameOverlay}
                </div>
              ) : null}
            </div>
            {belowStage}
          </div>

          <div className="flex min-w-0 flex-col gap-[18px] max-[847px]:bg-app-surface max-[847px]:gap-3 max-[847px]:p-4">
            <p className="text-app-muted text-center text-[13px] leading-[1.4] min-[848px]:hidden">{phoneHint}</p>
            {preview}
            <div className="flex flex-col gap-0.5">
              <span className="text-[15px] leading-[1.35] font-[650] max-[847px]:hidden">{t("zoom")}</span>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon" aria-label={t("zoomOut")} disabled={zoom <= MIN_ZOOM} onClick={() => framing.zoomBy("-")}>
                  <Minus aria-hidden="true" />
                </Button>
                <Slider
                  aria-label={t("zoom")}
                  aria-valuetext={t("zoomValue", { n: zoomPercent })}
                  min={MIN_ZOOM * 100}
                  max={MAX_ZOOM * 100}
                  step={1}
                  value={[zoomPercent]}
                  onValueChange={([next]) => next !== undefined && framing.setZoom(next / 100)}
                />
                <Button type="button" variant="ghost" size="icon" aria-label={t("zoomIn")} disabled={zoom >= MAX_ZOOM} onClick={() => framing.zoomBy("+")}>
                  <Plus aria-hidden="true" />
                </Button>
              </div>
            </div>
            {afterZoom}
            <Button type="button" variant="ghost" className="self-start px-2 max-[847px]:self-center" onClick={framing.reset}>
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
          data-testid={applyTestId}
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
