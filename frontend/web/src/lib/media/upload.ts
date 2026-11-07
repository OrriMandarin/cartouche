import { ApiError, toApiError, type components } from "@cartouche/api-client";
import type { MediaView } from "@/templates/contract";

export type MediaSlot = "header" | "avatar";
export type MediaKind = "image" | "video";
export type CropRect = components["schemas"]["CropRect"];
export type VideoLoop = components["schemas"]["VideoLoop"];

/**
 * How a media is framed on upload (MED-026, MED-028): its crop, and for a video its loop and the time of its
 * waiting image. Whatever is left out takes the server's default.
 */
export interface UploadFraming {
  crop?: CropRect;
  loop?: VideoLoop;
  posterTime?: number;
}

/** Sends a media of a card and returns what the server stored (`uploadMedia` bound to a card and a session). */
export type UploadMedia = (slot: MediaSlot, file: Blob, framing?: UploadFraming) => Promise<MediaView>;

/** Limits of the server (MED-002, MED-012), mirrored here to answer before sending; the server stays the arbiter. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
/** The server accepts up to 30.1 s: containers often report a few hundredths over 30 s for a 30 s video. */
export const MAX_VIDEO_SECONDS = 30.1;

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

/** Appends the framing fields given; whatever is left out takes the server's default. */
function appendFraming(form: FormData, framing: UploadFraming): void {
  if (framing.crop) form.append("crop", JSON.stringify(framing.crop));
  if (framing.loop) form.append("loop", JSON.stringify(framing.loop));
  if (framing.posterTime !== undefined) form.append("poster_time", String(framing.posterTime));
}

/** Posts a media form to `path` as the current session; a refusal is thrown as an `ApiError`. */
async function postMediaForm(getToken: () => Promise<string | null>, path: string, form: FormData): Promise<MediaView> {
  const headers = new Headers();
  const token = await getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  // Left unset, the browser adds the multipart boundary to `content-type`.
  const response = await fetch(path, { method: "POST", headers, body: form });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as MediaView;
}

/**
 * spec: MED-003, MED-026, MED-028. Sends a media to `POST /api/cards/{id}/media`: the slot, the file and the
 * framing given; the server makes the waiting image of a video. A refusal is thrown as an `ApiError`, as with the generated
 * client.
 */
export async function uploadMedia(
  getToken: () => Promise<string | null>,
  cardId: string,
  slot: MediaSlot,
  file: Blob,
  framing: UploadFraming = {},
): Promise<MediaView> {
  const form = new FormData();
  form.append("slot", slot);
  form.append("file", file, file instanceof File ? file.name : "media");
  appendFraming(form, framing);
  return postMediaForm(getToken, `/api/cards/${encodeURIComponent(cardId)}/media`, form);
}

/** The framing of a re-framed media: a crop is required; the loop and poster time are for a video. */
export interface ReframeFraming extends UploadFraming {
  crop: CropRect;
}

/** Re-frames a media of a card and returns the new one (`reframeMedia` bound to a card and a session). */
export type ReframeMedia = (mediaId: string, framing: ReframeFraming) => Promise<MediaView>;

/**
 * spec: MED-030. Makes a new media from the source of `mediaId` along `framing`, through
 * `POST /api/cards/{id}/media/{media_id}/reframe`; the server makes the new waiting image of a video. The card shows the new media once a save names it.
 */
export async function reframeMedia(
  getToken: () => Promise<string | null>,
  cardId: string,
  mediaId: string,
  framing: ReframeFraming,
): Promise<MediaView> {
  const form = new FormData();
  appendFraming(form, framing);
  const path = `/api/cards/${encodeURIComponent(cardId)}/media/${encodeURIComponent(mediaId)}/reframe`;
  return postMediaForm(getToken, path, form);
}

const ERROR_PREFIX = "editor.media.errors.";

/** Message key of a failed upload or re-framing (MED-012, MED-013, MED-030, MED-039): one message per code the server answers with. */
export function mediaErrorKey(error: unknown): string {
  if (error instanceof ApiError) {
    if ([
        "payload_too_large",
        "unsupported_media_type",
        "media_not_reframable",
        "video_processing_timeout",
      ].includes(error.code)) {
      return ERROR_PREFIX + error.code;
    }
    const known = ["video_too_long", "video_unreadable", "video_too_large", "image_too_large", "invalid_crop"];
    const refused = error.fields.find(
      ({ field, code }) => (field === "file" || field === "crop") && known.includes(code),
    );
    if (refused) return ERROR_PREFIX + refused.code;
  }
  return `${ERROR_PREFIX}generic`;
}
