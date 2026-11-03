import { ApiError, toApiError } from "@cartouche/api-client";
import type { MediaView } from "@/templates/contract";

export type MediaSlot = "header" | "avatar";
export type MediaKind = "image" | "video";

/** Sends a media of a card and returns what the server stored (`uploadMedia` bound to a card and a session). */
export type UploadMedia = (slot: MediaSlot, file: Blob, poster?: Blob) => Promise<MediaView>;

/** Limits of the server (MED-002, MED-012), mirrored here to answer before sending; the server stays the arbiter. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 30;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const VIDEO_TYPE = "video/mp4";

/** The `accept` attribute of the file picker of a slot, for the kinds of file it takes. */
export function acceptedTypes(kinds: readonly MediaKind[]): string {
  return [...(kinds.includes("image") ? IMAGE_TYPES : []), ...(kinds.includes("video") ? [VIDEO_TYPE] : [])].join(",");
}

/**
 * spec: MED-002, MED-012. A first answer before the file is sent: a type the slot does not take, or a file
 * heavier than the limit. `kinds` are the kinds the template takes in this slot (the avatar takes images only).
 */
export function checkBeforeUpload(
  file: File,
  slot: MediaSlot,
  kinds: readonly MediaKind[] = slot === "header" ? ["image", "video"] : ["image"],
): "unsupported" | "too_large" | null {
  const allowed = slot === "header" ? kinds : kinds.filter((kind) => kind === "image");
  if ((IMAGE_TYPES as readonly string[]).includes(file.type) && allowed.includes("image")) {
    return file.size > MAX_IMAGE_BYTES ? "too_large" : null;
  }
  if (file.type === VIDEO_TYPE && allowed.includes("video")) {
    return file.size > MAX_VIDEO_BYTES ? "too_large" : null;
  }
  return "unsupported";
}

/**
 * spec: MED-003. Sends a media to `POST /api/cards/{id}/media`: the slot, the file and, for a video, its
 * waiting image. A refusal is thrown as an `ApiError`, as with the generated client.
 */
export async function uploadMedia(
  getToken: () => Promise<string | null>,
  cardId: string,
  slot: MediaSlot,
  file: Blob,
  poster?: Blob,
): Promise<MediaView> {
  const form = new FormData();
  form.append("slot", slot);
  form.append("file", file, file instanceof File ? file.name : "media");
  if (poster) form.append("poster", poster, "poster.jpg");

  const headers = new Headers();
  const token = await getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  // Left unset, the browser adds the multipart boundary to `content-type`.
  const response = await fetch(`/api/cards/${encodeURIComponent(cardId)}/media`, {
    method: "POST",
    headers,
    body: form,
  });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as MediaView;
}

const ERROR_PREFIX = "editor.media.errors.";

/** Message key of a failed upload (MED-012, MED-013): one message per code the server answers with. */
export function mediaErrorKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "payload_too_large" || error.code === "unsupported_media_type") {
      return ERROR_PREFIX + error.code;
    }
    const known = ["video_too_long", "poster_required", "image_too_large"];
    const refused = error.fields.find(({ field, code }) => (field === "file" || field === "poster") && known.includes(code));
    if (refused) return ERROR_PREFIX + refused.code;
  }
  return `${ERROR_PREFIX}generic`;
}
