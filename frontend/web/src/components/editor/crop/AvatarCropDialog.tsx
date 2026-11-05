"use client";

import { useTranslations } from "next-intl";
import { videoCropStyle } from "@/lib/media/framing";
import type { CropRect } from "@/lib/media/upload";
import { CropDialogLayout } from "./CropDialogLayout";
import { useCropFraming } from "./useCropFraming";

export interface AvatarCropDialogProps {
  /** The photo to frame: the file chosen, or the address of a media's source when re-framing it (MED-030). */
  source: File | string;
  /** Where re-framing starts (MED-030); without it, the largest centred square (MED-026). */
  initialCrop?: CropRect | null;
  onApply: (crop: CropRect) => void;
  onCancel: () => void;
}

/** The sizes of the profile photo on the card and in the dashboard, in pixels (EDI-035). */
const CARD_SIZE = 112;
const APP_SIZE = 36;
/** The smaller card preview of a phone, where the stage takes the room. */
const PHONE_CARD_SIZE = 64;

/**
 * spec: EDI-035, MED-026, MED-030. « Recadrer la photo de profil »: a square frame under a round mask, in which
 * the owner moves and zooms the photo like in the header dialog (EDI-026), with previews at the real sizes of the
 * card (112 px) and of the dashboard (36 px). « Appliquer » hands back the square in proportions of the source.
 */
export function AvatarCropDialog({ source, initialCrop, onApply, onCancel }: AvatarCropDialogProps) {
  const t = useTranslations("editor.media.crop.avatar");
  const framing = useCropFraming(source, initialCrop);

  return (
    <CropDialogLayout
      framing={framing}
      initialCrop={initialCrop}
      aspect={1}
      round
      title={t("title")}
      stageLabel={t("stage")}
      phoneHint={t("phoneHint")}
      testId="avatar-crop-dialog"
      applyTestId="avatar-crop-apply"
      onApply={onApply}
      onCancel={onCancel}
      preview={
        <>
          <section className="flex flex-col gap-3 max-[847px]:hidden" aria-labelledby="avatar-crop-preview">
            <h3 id="avatar-crop-preview" className="text-[15px] leading-[1.35] font-[650]">
              {t("preview")}
            </h3>
            <div className="flex items-end gap-6">
              <Preview testId="avatar-preview-card" url={framing.url} crop={framing.crop} size={CARD_SIZE} label={t("previewCard")} />
              <Preview testId="avatar-preview-app" url={framing.url} crop={framing.crop} size={APP_SIZE} label={t("previewApp")} />
            </div>
          </section>
          <div aria-hidden="true" className="flex items-center justify-center gap-5 min-[848px]:hidden">
            <Preview url={framing.url} crop={framing.crop} size={PHONE_CARD_SIZE} />
            <Preview url={framing.url} crop={framing.crop} size={APP_SIZE} />
          </div>
        </>
      }
      afterZoom={<p className="text-app-muted text-[13px] leading-[1.4] max-[847px]:hidden">{t("hint")}</p>}
    />
  );
}

/** A round preview of the profile photo at its real size, cut along the crop. */
function Preview({ url, crop, size, label, testId }: { url: string | null; crop: CropRect | null; size: number; label?: string; testId?: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div data-testid={testId} className="bg-app-surface-2 relative overflow-hidden rounded-full" style={{ width: size, height: size }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- an object URL or a signed media URL */}
        {url ? <img src={url} alt="" className="block" style={videoCropStyle(crop)} /> : null}
      </div>
      {label ? <span className="text-app-muted text-[13px]">{label}</span> : null}
    </div>
  );
}
