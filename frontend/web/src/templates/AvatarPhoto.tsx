"use client";

import { useRef } from "react";
import { TEMPLATE_TEST_IDS as TEST_IDS, type MediaView } from "./contract";
import { srcSet } from "./srcset";
import { useMediaLoad } from "./useMediaLoad";

/**
 * The profile photo in its circle: the theme's surface under a sheen until the photo has loaded (PUB-040); if it
 * cannot load, the circle keeps the surface without sheen or busy mark. A load that ended before hydration is read
 * on mount (PUB-041).
 */
export function AvatarPhoto({ avatar, src, name }: { avatar: MediaView; src: string; name: string }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const loadState = useMediaLoad(imageRef, "image");
  const loading = loadState === "loading";
  const className = loading ? "cc-avatar is-loading" : loadState === "failed" ? "cc-avatar is-failed" : "cc-avatar";
  return (
    <div className={className} aria-busy={loading}>
      {/* eslint-disable-next-line @next/next/no-img-element -- see the header image */}
      <img
        ref={imageRef}
        data-testid={TEST_IDS.avatar}
        src={src}
        srcSet={srcSet(avatar)}
        sizes="112px"
        alt={name}
      />
      {loading && <div className="cc-shimmer" aria-hidden="true" />}
    </div>
  );
}
