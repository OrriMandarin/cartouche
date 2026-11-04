"use client";

import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { coveredZones, type FrameZone } from "@/lib/media/framing";

const percent = (fraction: number) => `${fraction * 100}%`;

function placed(zone: FrameZone): CSSProperties {
  return { left: percent(zone.left), top: percent(zone.top), width: percent(zone.width), height: percent(zone.height) };
}

const TAG = "bg-app-stage/80 text-app-on-stage absolute rounded-full px-2 py-0.5 text-xs leading-normal font-semibold whitespace-nowrap";
const DASHED = "border-app-on-stage absolute border-2 border-dashed";

/**
 * spec: EDI-026. What the card draws over its header, dotted over the 4:3 frame so the owner keeps the subject
 * clear of it: the fade towards the card's background (`fadeTo`), as high as the header gradient intensity, the
 * profile photo and the pause button of a video. It fills the frame it is placed in.
 */
export function CoveredZones({ headerGradient, fadeTo }: { headerGradient: number; fadeTo: string }) {
  const t = useTranslations("editor.media.crop.header");
  const zones = coveredZones(headerGradient);
  return (
    <div data-testid="covered-zones" aria-hidden="true" className="pointer-events-none absolute inset-0">
      {zones.fade.height > 0 ? (
        <>
          <div
            className="absolute border-t-2 border-dashed border-white/90"
            style={{
              ...placed(zones.fade),
              background: `linear-gradient(to bottom, transparent, color-mix(in srgb, ${fadeTo} 78%, transparent))`,
            }}
          />
          <span className={TAG} style={{ left: 10, top: `calc(${percent(zones.fade.top)} + 8px)` }}>
            {t("fade", { n: headerGradient })}
          </span>
        </>
      ) : null}
      <div className={`${DASHED} rounded-full bg-white/20`} style={placed(zones.avatar)} />
      <span
        className={`${TAG} -translate-x-1/2`}
        style={{ left: "50%", bottom: `calc(${percent(1 - zones.avatar.top)} + 6px)` }}
      >
        {t("avatar")}
      </span>
      <div className={`${DASHED} rounded-full`} style={placed(zones.pause)} />
    </div>
  );
}
