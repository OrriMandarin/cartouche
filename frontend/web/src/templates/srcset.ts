import type { MediaView } from "./contract";

/** The `srcset` attribute of an image media: every stored width, from the smallest to the largest. */
export function srcSet(media: MediaView): string {
  return media.images.map((image) => `${image.url} ${image.width}w`).join(", ");
}
