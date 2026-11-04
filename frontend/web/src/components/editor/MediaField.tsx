"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  acceptedTypes,
  checkBeforeUpload,
  mediaErrorKey,
  MAX_VIDEO_SECONDS,
  type MediaKind,
  type MediaSlot,
  type UploadFraming,
  type UploadMedia,
  VIDEO_TYPE,
} from "@/lib/media/upload";
import { capturePoster, POSTER_SECONDS, readVideoDuration } from "@/lib/media/video";
import type { MediaView, TemplateDefinition } from "@/templates/contract";
import { AvatarCropper } from "./AvatarCropper";

interface MediaFieldProps {
  /** The media the template declares: only these slots are offered (TPL-004). */
  media: TemplateDefinition<unknown>["media"];
  header: MediaView | null;
  avatar: MediaView | null;
  /** The media of a slot is now this one (an upload), or none (« Retirer »). */
  onChange: (slot: MediaSlot, media: MediaView | null) => void;
  upload: UploadMedia;
}

function SlotField({
  slot,
  kinds,
  value,
  onChange,
  upload,
}: {
  slot: MediaSlot;
  kinds: MediaKind[];
  value: MediaView | null;
  onChange: (media: MediaView | null) => void;
  upload: UploadMedia;
}) {
  const t = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [cropping, setCropping] = useState<File | null>(null);
  const hasVideo = kinds.includes("video");
  const hint = slot === "avatar" ? t("editor.media.avatarHint") : hasVideo ? t("editor.media.headerHintVideo") : t("editor.media.headerHintImage");
  const thumbnail = value?.images[0]?.url;

  async function send(file: Blob, poster?: Blob, framing?: UploadFraming) {
    setBusy(true);
    try {
      onChange(await upload(slot, file, poster, framing));
    } catch (error) {
      setErrorKey(mediaErrorKey(error));
    } finally {
      setBusy(false);
    }
  }

  async function sendVideo(file: File) {
    setBusy(true);
    let poster: Blob;
    try {
      // The server reads the duration again; this only spares the upload of a video it will refuse (MED-002).
      if ((await readVideoDuration(file)) > MAX_VIDEO_SECONDS) {
        setErrorKey("editor.media.errors.video_too_long");
        setBusy(false);
        return;
      }
      poster = await capturePoster(file);
    } catch {
      setErrorKey("editor.media.errors.unreadable");
      setBusy(false);
      return;
    }
    await send(file, poster, { posterTime: POSTER_SECONDS });
  }

  function choose(file: File) {
    setErrorKey(null);
    const refused = checkBeforeUpload(file, slot, kinds);
    if (refused) {
      setErrorKey(`editor.media.errors.${refused}`);
    } else if (slot === "avatar") {
      setCropping(file);
    } else if (file.type === VIDEO_TYPE) {
      void sendVideo(file);
    } else {
      void send(file);
    }
  }

  const inputId = `media-${slot}-input`;
  return (
    <div data-testid={`media-${slot}`} className="space-y-2">
      <Label htmlFor={inputId}>{t(`editor.media.${slot}`)}</Label>
      <p className="text-muted-foreground text-sm">{hint}</p>
      <div className="flex flex-wrap items-center gap-3">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- media URLs are absolute and external
          <img
            data-testid={`media-${slot}-thumbnail`}
            src={thumbnail}
            alt={t("editor.media.thumbnail")}
            className={`h-14 w-14 object-cover ${slot === "avatar" ? "rounded-full" : "rounded-md"}`}
          />
        ) : null}
        {value ? (
          <span data-testid={`media-${slot}-current`} className="text-sm">
            {t("editor.media.current", { kind: t(`editor.media.kinds.${value.kind}`) })}
          </span>
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
        <Button type="button" variant="outline" disabled={busy} data-testid={`media-${slot}-choose`} onClick={() => input.current?.click()}>
          {busy ? t("editor.media.uploading") : value ? t("editor.media.replace") : t("editor.media.choose")}
        </Button>
        {value ? (
          <Button type="button" variant="ghost" disabled={busy} data-testid={`media-${slot}-remove`} onClick={() => onChange(null)}>
            {t("editor.media.remove")}
          </Button>
        ) : null}
      </div>
      {errorKey ? (
        <p data-testid={`media-${slot}-error`} role="alert" className="text-destructive text-sm">
          {t(errorKey)}
        </p>
      ) : null}
      {cropping ? (
        <AvatarCropper
          file={cropping}
          onCancel={() => setCropping(null)}
          onError={() => {
            setCropping(null);
            setErrorKey("editor.media.errors.unreadable");
          }}
          onConfirm={(square) => {
            setCropping(null);
            void send(square);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * spec: MED-001, MED-005, TPL-004. One field per media the template declares: the header (an image, and a
 * video when the template takes one) and the profile photo. An upload replaces the draft's media; it reaches
 * the card only on save (MED-018).
 */
export function MediaField({ media, header, avatar, onChange, upload }: MediaFieldProps) {
  return (
    <div className="space-y-6">
      {media.header.length > 0 ? (
        <SlotField slot="header" kinds={media.header} value={header} onChange={(m) => onChange("header", m)} upload={upload} />
      ) : null}
      {media.avatar ? (
        <SlotField slot="avatar" kinds={["image"]} value={avatar} onChange={(m) => onChange("avatar", m)} upload={upload} />
      ) : null}
    </div>
  );
}
