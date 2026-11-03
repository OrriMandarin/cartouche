# Media

> Status: implemented (plans 2 and 3); MED-003, MED-005 and MED-015 amended, MED-025 to MED-033: plan 6 (phase A, except the crop dialogs of EDI-026: phase B)

## Header backgrounds and profile photo

- **MED-001** — A card has a single header background, which is an image or a video.
- **MED-002** — The header video is in MP4 format, limited to 30 s and 25 MB.
- **MED-003** — When a video is uploaded or re-framed, the browser captures the whole frame at the poster time (MED-028) through a canvas and sends it as the placeholder image (see PUB-006 and MED-029).
- **MED-021** — If the browser could not read a video chosen in the editor after 15 seconds, the upload is abandoned with a message, and the field becomes usable again.
- **MED-004** — There is no server-side video transcoding in v1.
- **MED-005** — A card has a single profile photo, square and shown in a circle. Its square is chosen in the editor (EDI-026) and cut by the server (MED-027).

## Image processing

- **MED-006** — Images are resized to several sizes and converted to WebP on the server.
- **MED-007** — The EXIF metadata of images, including the GPS location, is removed.
- **MED-008** — A file's type is checked from its actual content, not only from its extension.
- **MED-012** — Accepted images are JPEG, PNG or WebP, weigh at most 10 MB and have at most 40 million pixels; dimensions are checked before decoding the whole image. A rejected type gives `415 unsupported_media_type`, a file that is too heavy `413 payload_too_large`, an image that is too large `400` with the code `image_too_large`.
- **MED-022** — A video is recognized as MP4 only if the major brand of its `ftyp` box, or one of its compatible brands, is an MP4 brand (`isom`, `iso2` to `iso6`, `mp41`, `mp42`, `avc1`, `M4V `, `dash`), and its major brand is not that of another format (QuickTime `qt  `, 3GP `3gp*` and `3g2*`, audio `M4A ` and `M4B `, images `heic`, `heix`, `mif1`, `msf1`, `avif`). Otherwise it is rejected with `415 unsupported_media_type`.
- **MED-013** — A video's duration is read from the file by the server, without trusting the browser; beyond 30 s, the video is rejected with the code `video_too_long`. A video always arrives with its placeholder image (see MED-003), treated as a header image; without it, the upload is rejected with the code `poster_required`.
- **MED-014** — A photo's EXIF orientation is applied before its metadata is removed: the photo displays the right way up.
- **MED-015** — Sizes produced, never enlarging the cropped area: for the profile photo, squares of 128, 256 and 512 pixels in WebP, plus 256 and 512 pixels in JPEG for the vCard and the link preview (see PUB-025 and PUB-028); for the header image and a video's placeholder image, 4:3 images 750, 1,125 and 1,440 pixels wide in WebP, whose height is the width × 3/4 rounded to the nearest pixel. Media uploaded before plan 6 keep the files produced then (640, 1,080 and 1,920 pixels wide, uncropped).

## Storage and delivery

- **MED-009** — Media storage is the local disk by default, or S3-compatible storage by configuration, with no code change.
- **MED-010** — In local disk mode, the API serves `/media/*` with long cache headers and versioned file names, behind any reverse proxy and without sharing a volume with it.
- **MED-011** — In S3 mode, media is served from the bucket's public URL.
- **MED-016** — A media file is never modified: replacing a media creates a new file, under a new name. `/media/*` is served with the header `Cache-Control: public, max-age=31536000, immutable`.
- **MED-017** — `/media/*` answers partial requests (`Range` header, `206` response), without which iOS does not play videos.
- **MED-018** — A media uploaded from the editor is attached to the card only on save (see EDI-006). Media uploaded but not kept is deleted on the card's next save, and a replaced or removed media is deleted from storage.
- **MED-019** — Deleting a card deletes its media from storage.
- **MED-020** — Only a card's owner can upload media to it or remove media from it (see ACC-017).
- **MED-023** — In local disk mode, `/media/cards/<card>/…` answers 404 when the card is not served (see LNK-026), which is checked on every request. The media URLs received by the dashboard and the support page carry a signature valid for at least 24 hours, which makes them readable even when the card is not served (see LNK-008 and ADM-013); as an exception to MED-016, they are served with `Cache-Control: private, max-age=86400`. Copies already cached by visitors are not recalled.
- **MED-024** — In S3 mode, the files of a card that is not served stay readable at their bucket URL, which cannot be guessed: v1 does not cut off their delivery. They disappear when the media is replaced or removed (MED-018) or when the card is deleted (MED-019).

## Framing

- **MED-025** — The server keeps the whole image of each media, called its source: the uploaded image, or the whole frame captured for a video's placeholder image (MED-003), turned the right way up (MED-014), stripped of its metadata (MED-007) and re-encoded in WebP, its longer side reduced to 4,096 pixels when it is longer. The uploaded image bytes themselves are never stored; a video file is stored as uploaded (MED-004).
- **MED-026** — A crop is a rectangle `{x, y, width, height}` given in proportions of the source, from 0 to 1: x and y are at least 0, width and height are more than 0, x + width and y + height are at most 1. Measured in pixels of the source, it is 4:3 for the header and square for the profile photo, within 1%. Any other crop is rejected (`400`, field `crop`, code `invalid_crop`). When an upload carries no crop, the server takes the largest centered rectangle of the right shape.
- **MED-027** — The files shown on the card (MED-015) are cut by the server from the source along the crop, so that the media can be re-framed later (MED-030).
- **MED-028** — A header video carries a framing: its crop (MED-026), its loop `{start, end}` and its poster time, in seconds. The loop satisfies 0 ≤ start < end ≤ the video's duration as the server read it (MED-013), and end − start ≥ 1 unless the loop is the whole video; otherwise the upload is rejected (`400`, field `loop`, code `invalid_loop`). The poster time lies between 0 and the duration (field `poster_time`, code `invalid_poster_time`). Without them, the loop is the whole video and the poster time is 0.
- **MED-029** — A video's placeholder image is the frame captured at its poster time (MED-003), cut by the server along the video's crop like a header image (MED-027).
- **MED-030** — Re-framing a media (a new crop and, for a video, a new loop or poster time, with a newly captured frame when the poster time changes) creates a new media from the source of the previous one; the previous media and its files are not modified (MED-016). Like an upload, the new media is shown on the card only once a save attaches it (MED-018). A media uploaded before plan 6 has no source and cannot be re-framed (`409 media_not_reframable`): it must be replaced.
- **MED-031** — A source is only readable through a signed address given to the card's owner in the dashboard (MED-023), to re-frame the media. It is never part of the public page, of the vCard or of the support views, and `/media/*` refuses it (404) without a valid signature, even when the card is served.
- **MED-032** — The public page applies a video's crop when it displays it, without modifying the file (MED-004): only the cropped area fills the 4:3 header. Playback starts at the loop's start and goes back to it at the loop's end.
- **MED-033** — A media uploaded before plan 6 has no crop: its image or its video covers the 4:3 header, centered, and a video loops over its whole length.
