"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { cropToSquare } from "@/lib/media/crop";

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

/**
 * spec: MED-005. The profile photo is framed in a square, under a round mask; « Valider » hands back the
 * square JPEG of the chosen area.
 */
export function AvatarCropper({
  file,
  onConfirm,
  onCancel,
  onError,
}: {
  file: File;
  onConfirm: (square: Blob) => void;
  onCancel: () => void;
  /** The photo could not be cropped (undecodable image, no canvas): the caller tells the owner. */
  onError: () => void;
}) {
  const t = useTranslations("editor.media.cropper");
  const [url, setUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    // The object URL is a resource of the browser that this effect owns, from creation to release.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  async function confirm() {
    if (!area || busy) return;
    setBusy(true);
    try {
      onConfirm(await cropToSquare(file, area));
    } catch {
      onError();
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent data-testid="avatar-cropper" closeLabel={t("cancel")}>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="bg-muted relative h-72 w-full overflow-hidden rounded-md">
          {url ? (
            <Cropper
              image={url}
              crop={crop}
              zoom={zoom}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setArea(pixels)}
            />
          ) : null}
        </div>
        <Slider
          aria-label={t("zoom")}
          data-testid="avatar-zoom"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.05}
          value={[zoom]}
          onValueChange={([next]) => setZoom(next ?? MIN_ZOOM)}
        />
        <DialogFooter>
          <Button type="button" variant="outline" data-testid="avatar-crop-cancel" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button type="button" data-testid="avatar-crop-confirm" disabled={!area || busy} onClick={() => void confirm()}>
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
