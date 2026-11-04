"use client";

import { Crop, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AVATAR_RATIO, HEADER_RATIO, needsCrop } from "@/lib/media/framing";
import { readImageSize } from "@/lib/media/image";
import {
  acceptedTypes,
  checkBeforeUpload,
  mediaErrorKey,
  MAX_VIDEO_SECONDS,
  type CropRect,
  type MediaKind,
  type MediaSlot,
  type ReframeMedia,
  type UploadFraming,
  type UploadMedia,
  VIDEO_TYPE,
} from "@/lib/media/upload";
import { capturePoster, POSTER_SECONDS, readVideoInfo } from "@/lib/media/video";
import type { ResolvedTheme } from "@/lib/theme/resolve";
import type { MediaView, TemplateDefinition } from "@/templates/contract";
import { AvatarCropDialog } from "./crop/AvatarCropDialog";
import { HeaderCropDialog } from "./crop/HeaderCropDialog";
import { VideoCropDialog, type VideoFraming } from "./crop/VideoCropDialog";

interface MediaFieldProps {
  /** The media the template declares: only these slots are offered (TPL-004). */
  media: TemplateDefinition<unknown>["media"];
  header: MediaView | null;
  avatar: MediaView | null;
  /** The media of a slot is now this one (an upload or a re-framing), or none (« Retirer »). */
  onChange: (slot: MediaSlot, media: MediaView | null) => void;
  upload: UploadMedia;
  reframe: ReframeMedia;
  /** The card the crop dialog previews: its theme and its name. */
  theme: ResolvedTheme;
  name: string | null;
}

/**
 * What a crop dialog frames: a file chosen, before its upload, or the current media (re-framed from the source of a
 * photo, from the file of a video). A video also has its duration.
 */
type Framing =
  | { file: File; videoDuration?: number }
  | { media: MediaView; source: string; videoDuration?: number };

function SlotField({
  slot,
  kinds,
  value,
  onChange,
  upload,
  reframe,
  preview,
}: {
  slot: MediaSlot;
  kinds: MediaKind[];
  value: MediaView | null;
  onChange: (media: MediaView | null) => void;
  upload: UploadMedia;
  reframe: ReframeMedia;
  preview: { theme: ResolvedTheme; name: string | null; avatarUrl?: string };
}) {
  const t = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [framing, setFraming] = useState<Framing | null>(null);
  const hasVideo = kinds.includes("video");
  const hint = slot === "avatar" ? t("editor.media.avatarHint") : hasVideo ? t("editor.media.headerHintVideo") : t("editor.media.headerHintImage");
  const thumbnail = value?.images[0]?.url;
  const inputId = `media-${slot}-input`;
  const cropHintId = `media-${slot}-crop-hint`;
  const canOfferCrop = value !== null;
  const ratio = slot === "avatar" ? AVATAR_RATIO : HEADER_RATIO;
  // A video is re-framed from its file, over its duration (EDI-034).
  const reframable = Boolean(value?.source) && (value?.kind === "image" || Boolean(value?.video_url && value.duration_seconds));

  /** Runs an upload or a re-framing; its media replaces the draft's, a refusal is shown. */
  async function store(request: () => Promise<MediaView>) {
    setBusy(true);
    try {
      onChange(await request());
    } catch (error) {
      setErrorKey(mediaErrorKey(error));
    } finally {
      setBusy(false);
    }
  }

  const send = (file: Blob, poster?: Blob, framing?: UploadFraming) => store(() => upload(slot, file, poster, framing));

  /** spec: MED-003. Sends a video with its waiting image, captured at its poster time. */
  async function sendVideo(file: File, framing: UploadFraming & { posterTime: number }) {
    setBusy(true);
    let poster: Blob;
    try {
      poster = await capturePoster(file, framing.posterTime);
    } catch {
      setErrorKey("editor.media.errors.unreadable");
      setBusy(false);
      return;
    }
    await send(file, poster, framing);
  }

  /** spec: MED-002, EDI-026, EDI-034. A video off the 4:3 shape is framed before it is sent; a 4:3 one goes as it is. */
  async function chooseVideo(file: File) {
    setBusy(true);
    let info: { duration: number; width: number; height: number };
    try {
      info = await readVideoInfo(file);
    } catch {
      setErrorKey("editor.media.errors.unreadable");
      setBusy(false);
      return;
    }
    setBusy(false);
    // The server reads the duration again; this only spares the upload of a video it will refuse (MED-002).
    if (info.duration > MAX_VIDEO_SECONDS) setErrorKey("editor.media.errors.video_too_long");
    else if (needsCrop(info.width, info.height, HEADER_RATIO)) setFraming({ file, videoDuration: info.duration });
    else void sendVideo(file, { posterTime: POSTER_SECONDS });
  }

  /** spec: EDI-026, EDI-035. A photo off the slot's shape (4:3 header, square profile photo) is framed before it is sent. */
  async function sendImage(file: File) {
    setBusy(true);
    let size: { width: number; height: number };
    try {
      size = await readImageSize(file);
    } catch {
      setErrorKey("editor.media.errors.unreadable");
      setBusy(false);
      return;
    }
    setBusy(false);
    if (needsCrop(size.width, size.height, ratio)) setFraming({ file });
    else void send(file);
  }

  function choose(file: File) {
    setErrorKey(null);
    const refused = checkBeforeUpload(file, slot, kinds);
    if (refused) {
      setErrorKey(`editor.media.errors.${refused}`);
    } else if (file.type === VIDEO_TYPE) {
      void chooseVideo(file);
    } else {
      void sendImage(file);
    }
  }

  /** spec: EDI-026, EDI-035, MED-005, MED-030. The new file is uploaded with its crop; the current media is re-framed from its source. */
  function apply(crop: CropRect) {
    if (!framing) return;
    setFraming(null);
    setErrorKey(null);
    if ("file" in framing) void send(framing.file, undefined, { crop });
    else void store(() => reframe(framing.media.id, { crop }));
  }

  /**
   * spec: EDI-034, MED-028, MED-030. A new video is uploaded with its framing and its waiting image; the current one
   * is re-framed, with the frame at the new poster time when the owner chose one. The loop is always sent.
   */
  async function applyVideo({ newPoster, ...framed }: VideoFraming) {
    if (!framing) return;
    setFraming(null);
    setErrorKey(null);
    if ("file" in framing) {
      await sendVideo(framing.file, framed);
      return;
    }
    let poster: Blob | undefined;
    if (newPoster) {
      setBusy(true);
      try {
        poster = await capturePoster(framing.source, framed.posterTime);
      } catch {
        setErrorKey("editor.media.errors.unreadable");
        setBusy(false);
        return;
      }
    }
    await store(() => reframe(framing.media.id, framed, poster));
  }

  function recrop() {
    if (!value?.source) return;
    setErrorKey(null);
    if (value.kind === "video" && value.video_url && value.duration_seconds) {
      setFraming({ media: value, source: value.video_url, videoDuration: value.duration_seconds });
    } else {
      setFraming({ media: value, source: value.source.url });
    }
  }

  return (
    <div data-testid={`media-${slot}`} className="flex min-w-0 flex-col gap-2.5">
      <Label htmlFor={inputId}>{t(`editor.media.${slot}`)}</Label>
      {slot === "header" && value ? (
        <div className="bg-app-surface-2 relative aspect-[4/3] overflow-hidden rounded-xl">
          {thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element -- media URLs are absolute and external
            <img
              data-testid="media-header-thumbnail"
              src={thumbnail}
              alt={t("editor.media.thumbnail")}
              className="block size-full object-cover"
            />
          ) : null}
          <span
            data-testid="media-header-current"
            className="absolute top-2.5 left-2.5 rounded-full bg-[rgb(28_27_25/.78)] px-2.5 py-0.5 text-[13px] leading-normal font-semibold text-white"
          >
            {value.kind === "video" && value.duration_seconds
              ? t("editor.media.headerKind.videoLength", { seconds: Math.round(value.duration_seconds) })
              : t(`editor.media.headerKind.${value.kind}`)}
          </span>
        </div>
      ) : null}
      {slot === "avatar" ? (
        <div className="flex flex-wrap items-center gap-3">
          {thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element -- media URLs are absolute and external
            <img
              data-testid="media-avatar-thumbnail"
              src={thumbnail}
              alt={t("editor.media.thumbnail")}
              className="h-14 w-14 rounded-full object-cover"
            />
          ) : null}
          {value ? (
            <span data-testid="media-avatar-current" className="text-sm">
              {t("editor.media.current", { kind: t(`editor.media.kinds.${value.kind}`) })}
            </span>
          ) : null}
        </div>
      ) : null}
      {/* The native input stays out of sight and is driven by the button, which can be styled. */}
      <input
        ref={input}
        id={inputId}
        data-testid={inputId}
        type="file"
        className="sr-only"
        tabIndex={-1}
        accept={acceptedTypes(kinds)}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) choose(file);
        }}
      />
      <div className="flex flex-wrap gap-2">
        {canOfferCrop ? (
          <Button
            type="button"
            variant="secondary"
            data-testid={`media-${slot}-crop`}
            disabled={busy || !reframable}
            aria-describedby={reframable ? undefined : cropHintId}
            onClick={recrop}
          >
            <Crop aria-hidden="true" />
            {t("editor.media.recrop")}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" disabled={busy} data-testid={`media-${slot}-choose`} onClick={() => input.current?.click()}>
          <Upload aria-hidden="true" />
          {busy ? t("editor.media.uploading") : value ? t("editor.media.replace") : t("editor.media.choose")}
        </Button>
        {value ? (
          <Button type="button" variant="ghost" disabled={busy} data-testid={`media-${slot}-remove`} onClick={() => onChange(null)}>
            {t("editor.media.remove")}
          </Button>
        ) : null}
      </div>
      {canOfferCrop && !reframable ? (
        <p id={cropHintId} className="text-app-muted text-[13px] leading-[1.4]">
          {t("editor.media.cannotRecrop")}
        </p>
      ) : null}
      <p className="text-app-muted text-[13px] leading-[1.4]">{hint}</p>
      {errorKey ? (
        <p data-testid={`media-${slot}-error`} role="alert" className="text-app-danger text-sm">
          {t(errorKey)}
        </p>
      ) : null}
      {framing && slot === "avatar" ? (
        <AvatarCropDialog
          source={"file" in framing ? framing.file : framing.source}
          initialCrop={"media" in framing ? framing.media.crop : null}
          onApply={apply}
          onCancel={() => setFraming(null)}
        />
      ) : null}
      {framing && slot === "header" && framing.videoDuration !== undefined ? (
        <VideoCropDialog
          video={"file" in framing ? framing.file : framing.source}
          duration={framing.videoDuration}
          initialCrop={"media" in framing ? framing.media.crop : null}
          initialLoop={"media" in framing ? framing.media.loop : null}
          initialPosterTime={"media" in framing ? framing.media.poster_time : null}
          theme={preview.theme}
          name={preview.name}
          avatarUrl={preview.avatarUrl}
          onApply={(framed) => void applyVideo(framed)}
          onCancel={() => setFraming(null)}
        />
      ) : null}
      {framing && slot === "header" && framing.videoDuration === undefined ? (
        <HeaderCropDialog
          source={"file" in framing ? framing.file : framing.source}
          initialCrop={"media" in framing ? framing.media.crop : null}
          theme={preview.theme}
          name={preview.name}
          avatarUrl={preview.avatarUrl}
          onApply={apply}
          onCancel={() => setFraming(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * spec: MED-001, MED-005, TPL-004, EDI-026, EDI-034, EDI-035, MED-030. One field per media the template declares:
 * the header (an image, and a video when the template takes one) and the profile photo, each framed in its dialog
 * and re-framed with « Recadrer ». An upload or a re-framing replaces the draft's media; it reaches the card only on save (MED-018).
 */
export function MediaField({ media, header, avatar, onChange, upload, reframe, theme, name }: MediaFieldProps) {
  const preview = { theme, name, avatarUrl: avatar?.images.at(-1)?.url };
  return (
    <div className="grid gap-6 @min-[848px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      {media.header.length > 0 ? (
        <SlotField
          slot="header"
          kinds={media.header}
          value={header}
          onChange={(m) => onChange("header", m)}
          upload={upload}
          reframe={reframe}
          preview={preview}
        />
      ) : null}
      {media.avatar ? (
        <SlotField
          slot="avatar"
          kinds={["image"]}
          value={avatar}
          onChange={(m) => onChange("avatar", m)}
          upload={upload}
          reframe={reframe}
          preview={preview}
        />
      ) : null}
    </div>
  );
}
