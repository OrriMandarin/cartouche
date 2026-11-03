# Media

> Status: implemented (plans 2 and 3)

## Header backgrounds and profile photo

- **MED-001** — A card has a single header background, which is an image or a video.
- **MED-002** — The header video is in MP4 format, limited to 30 s and 25 MB.
- **MED-003** — When a video is uploaded, a still image is captured in the browser (via a canvas) and serves as the placeholder image (see PUB-006).
- **MED-021** — If the browser could not read a video chosen in the editor after 15 seconds, the upload is abandoned with a message, and the field becomes usable again.
- **MED-004** — There is no server-side video transcoding in v1.
- **MED-005** — A card has a single profile photo, cropped to a circle in the editor.

## Image processing

- **MED-006** — Images are resized to several sizes and converted to WebP on the server.
- **MED-007** — The EXIF metadata of images, including the GPS location, is removed.
- **MED-008** — A file's type is checked from its actual content, not only from its extension.
- **MED-012** — Accepted images are JPEG, PNG or WebP, weigh at most 10 MB and have at most 40 million pixels; dimensions are checked before decoding the whole image. A rejected type gives `415 unsupported_media_type`, a file that is too heavy `413 payload_too_large`, an image that is too large `400` with the code `image_too_large`.
- **MED-022** — A video is recognized as MP4 only if the major brand of its `ftyp` box, or one of its compatible brands, is an MP4 brand (`isom`, `iso2` to `iso6`, `mp41`, `mp42`, `avc1`, `M4V `, `dash`), and its major brand is not that of another format (QuickTime `qt  `, 3GP `3gp*` and `3g2*`, audio `M4A ` and `M4B `, images `heic`, `heix`, `mif1`, `msf1`, `avif`). Otherwise it is rejected with `415 unsupported_media_type`.
- **MED-013** — A video's duration is read from the file by the server, without trusting the browser; beyond 30 s, the video is rejected with the code `video_too_long`. A video always arrives with its placeholder image (see MED-003), treated as a header image; without it, the upload is rejected with the code `poster_required`.
- **MED-014** — A photo's EXIF orientation is applied before its metadata is removed: the photo displays the right way up.
- **MED-015** — Sizes produced, never enlarging the original image: for the profile photo, squares of 128, 256 and 512 pixels in WebP, plus 256 and 512 pixels in JPEG for the vCard and the link preview (see PUB-025 and PUB-028); for the header background and a video's placeholder image, 640, 1,080 and 1,920 pixels wide in WebP.

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
