"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { HEADER_RATIO, videoCropStyle } from "@/lib/media/framing";
import type { CropRect } from "@/lib/media/upload";
import { themeToCssVars } from "@/lib/theme/css-vars";
import type { ResolvedTheme } from "@/lib/theme/resolve";
import { CoveredZones } from "./CoveredZones";
import { CropDialogLayout } from "./CropDialogLayout";
import { useCropFraming } from "./useCropFraming";

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

/**
 * spec: EDI-026, MED-026, MED-030. « Recadrer l’en-tête »: a fixed 4:3 frame over a rule-of-thirds grid, in which
 * the owner moves and zooms the photo (100 to 300 %) with the pointer, a pinch, the arrows and + / −. The zones the
 * card covers are drawn dotted and can be hidden; « Sur ta carte » previews the result; « Réinitialiser » returns to
 * the default crop and « Appliquer » hands back the crop in proportions of the source. Full screen on a phone.
 */
export function HeaderCropDialog({ source, initialCrop, theme, avatarUrl, name, onApply, onCancel }: HeaderCropDialogProps) {
  const t = useTranslations("editor.media.crop");
  const framing = useCropFraming(source, initialCrop);
  const [showZones, setShowZones] = useState(true);
  const fadeTo = theme.background.kind === "solid" ? theme.background.color : theme.background.to;

  return (
    <CropDialogLayout
      framing={framing}
      initialCrop={initialCrop}
      aspect={HEADER_RATIO}
      title={t("header.title")}
      stageLabel={t("header.stage")}
      phoneHint={t("header.phoneHint")}
      testId="header-crop-dialog"
      applyTestId="header-crop-apply"
      onApply={onApply}
      onCancel={onCancel}
      frameOverlay={
        <>
          {showZones ? <CoveredZones headerGradient={theme.headerGradient} fadeTo={fadeTo} /> : null}
          {["-top-2 -left-2", "-top-2 -right-2", "-bottom-2 -left-2", "-bottom-2 -right-2"].map((corner) => (
            <span
              key={corner}
              aria-hidden="true"
              className={`bg-app-on-stage absolute size-4 rounded-[4px] shadow-[0_1px_3px_rgb(0_0_0/.45)] ${corner}`}
            />
          ))}
        </>
      }
      preview={
        <section className="flex flex-col gap-2.5 max-[847px]:hidden" aria-labelledby="header-crop-preview">
          <h3 id="header-crop-preview" className="text-[15px] leading-[1.35] font-[650]">
            {t("header.preview")}
          </h3>
          <CardPreview url={framing.url} crop={framing.crop} theme={theme} avatarUrl={avatarUrl} name={name} />
        </section>
      }
      afterZoom={
        <>
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
        </>
      }
    />
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
