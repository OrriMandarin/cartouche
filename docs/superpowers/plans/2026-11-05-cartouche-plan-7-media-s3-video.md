# Cartouche — Plan 7: Media on S3, server-side video, public-page loaders — Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the media pipeline so that what v1 ships is what runs everywhere: S3-compatible storage by default in development, tests, end-to-end tests and production (Garage in compose), media served from their own origin with exact headers, header videos transcoded by the server with ffmpeg (crop and loop applied at encode, H.264 1,280 × 960 at most, no sound, no metadata, placeholder image extracted by the server, original kept privately so that a video can be re-framed), reliable loaders on the public page for the header image, the header video and the profile photo, and an optimised dev build of the dependencies so that a large photo uploads in reasonable time through `localhost:3000`.

**Architecture:** Pure rules go to `cartouche-domain`: a new `video.rs` (probe checks, codec allow-list, the served-file and edit-copy sizes, the pixel crop on the displayed frame, the trim and the poster seek, the limits), `media.rs` (50 MB) and `media_files.rs` (the `source-<token>.mp4` edit-copy name, `original.mp4`). `cartouche-api` gets `media/video.rs`: a `VideoProcessor` trait (`probe`, `render`), its `Ffmpeg` adapter (`tokio::process`, a temp dir per job, `kill_on_drop`) and a `VideoService` that runs one job at a time under one 120 s deadline; `MediaService` gets a second, private store (second bucket in S3 mode, `private/` prefix in local mode) and stores `Content-Disposition: inline` with each public S3 object; the upload and re-frame routes stop taking a browser poster and call the video service; the config gains `MEDIA_S3_PRIVATE_BUCKET`, `FFMPEG_PATH`, `FFPROBE_PATH`, defaults to `s3` and refuses a media origin equal to the app origin; `main` checks ffmpeg at startup. The web drops the canvas poster capture, re-frames a video from its edit copy, plays the served file as is (`loop`, no CSS crop) and gets image, avatar and video loaders that survive hydration and errors. Compose files gain `garage` and a one-shot `garage-init`; CI installs ffmpeg and starts Garage.

**Tech Stack:** what plans 1 to 6 use (Rust 2024, Axum 0.8, SQLx 0.9 offline, utoipa 5, `image`, `webp`, `object_store` 0.14.2 with the `aws` feature — it already has `Attribute::ContentDisposition` and `prefix::PrefixStore` · Next 16, React 19, Tailwind 4, next-intl, openapi-fetch, Vitest, Playwright 1.64) + Rust dependencies: `tempfile = "3.27"` (checked with `cargo search`, 3.27.0) in `cartouche-api` `[dependencies]` (temp dir per video job) and the `process` and `fs` features of `tokio`. Tools: **ffmpeg + ffprobe** (≥ 5.1: Debian bookworm, the production image; the developer's Mac has 8.1.2 through Homebrew; CI's Ubuntu 24.04 has 6.1), **Garage `dxflrs/garage:v2.5.0`** (S3 API :3900, web endpoint :3902, admin API :3903), `curlimages/curl` for the init script. No new web dependency.

**Spec:** `spec/` is authoritative. Rules added or amended for this plan — `media.md`: MED-002, MED-003, MED-004, MED-009, MED-011, MED-013, MED-016, MED-017, MED-018, MED-019, MED-025, MED-026, MED-029, MED-030, MED-031, MED-032, MED-033 amended; MED-034 to MED-046 added. `public-page.md`: PUB-004, PUB-005, PUB-006 amended; PUB-039 to PUB-042 added. `dashboard-editor.md`: EDI-034 amended; EDI-037 added. Glossary: "Source" reworded; "Original", "Served file", "Edit copy" added. Design brief (owner decisions and verified facts): the session notes `plan7-media-brief.md`; visual reference for the loaders: `frontend/design/HANDOFF.md` §4 and `tokens/card-classique.css` (`.cc-shimmer`, `.is-blur`); transcode reference: HANDOFF §7.

**Paths:** `backend/` (Cargo workspace: `domain/`, `server/`), `frontend/` (pnpm workspace: `web/`, `api-client/`, `e2e/`), `docker/garage/` (new). Local machine: `source ~/.cargo/env` and `export PATH="$HOME/.local/bin:$PATH"` before `make`. **This worktree's `.env` defines its own ports: `DEV_DB_PORT` (Postgres, with the matching `DATABASE_URL`), `DEV_S3_PORT` (Garage S3 API), `DEV_S3_WEB_PORT` (Garage web endpoint) and `DEV_S3_ADMIN_PORT` (Garage admin API).** `make dev-db` starts this worktree's own Postgres and, from T9 on, its own Garage on those ports: **never run the Rust tests against the shared server on 54320** (`#[sqlx::test]` databases are named after the test path only, two worktrees on one server destroy each other's databases). `make e2e` uses the docker compose project `cartouche-test` with fixed ports, shared by every worktree of the machine: **only one worktree runs `make e2e` at a time** — check `docker compose -p cartouche-test ps` first. ffmpeg must be on the `PATH` (`brew install ffmpeg`) from T4 on.

**Follow-ups:** `docs/superpowers/plans/2026-11-05-cartouche-plan-7-followups.md` (rulings R-S1 to R-S31, points for plan 5, open points; execution rulings and deferred findings are added there during execution).

---

## Points ruled without the owner

The owner decided: S3 everywhere with Garage in compose and local mode kept selectable; media on their own origin with exact stored headers and a sandboxing CSP in local mode; ffmpeg behind a trait, header videos transcoded server-side with crop and loop applied at encode, poster extracted server-side, original kept privately, bounded CPU and time; loaders for the header image, header video and avatar; `opt-level = 3` for dependencies in dev and a measurement. Everything else was decided here, written as a numbered rule and recorded as a ruling (`R-S<n>`) in the follow-ups file. **Rulings that change behaviour plans 2 to 6 shipped: R-S1, R-S6, R-S7, R-S12, R-S15, R-S17, R-S18, R-S20.**

1. **(changes implemented behaviour) Transcoding replaces playback crop and loop** (MED-004, MED-032, MED-034, PUB-004, PUB-005, R-S1): plan 6's R-S1 (CSS crop, `timeupdate` loop) goes; preset `medium` instead of the handoff's `slow` (VPS CPU). Tasks T2, T3, T7, T13.
2. **Served-file size** (MED-035, R-S2): width = min(crop width in px, 1,280) rounded down to a multiple of 8, height = width × 3/4; a crop narrower than 16 px → `invalid_crop`. Task T2.
3. **Edit copy is the video's source** (MED-025, MED-031, MED-037, R-S3): whole frame, whole video, longer side ≤ 960 px, CRF 30, preset `veryfast`, no sound, fast start; `source-<32 hex>.mp4` in the public bucket, owner-only like an image source; no DB migration. Tasks T2, T7.
4. **Private original = the uploaded bytes** (MED-036, MED-044, R-S4): never served; copied on re-frame and duplication; deleted with the media and the card. Tasks T5, T7, T8.
5. **No sound, no metadata** in the served file and the edit copy (MED-038, R-S5): only `0:v:0`, `-map_metadata -1`. Task T3.
6. **(changes implemented behaviour) No browser poster** (MED-003, MED-013, MED-029, R-S6): the server extracts the frame at the poster time (last frame at or past the end); a `poster` field → `400 invalid_request`; the `poster_required` code disappears. Tasks T7, T8, T12.
7. **(changes implemented behaviour) Video limit 25 → 50 MB** (MED-002, R-S7): upload body 36 → 52 MiB, Next `proxyClientMaxBodySize` 40mb → 56mb, Next `experimental.proxyTimeout` 30 s → 180 s. Tasks T2, T7, T11.
8. **Processing limits** (MED-039, R-S8): one video job at a time, one 120 s deadline covering the wait and the run → `503 video_processing_timeout`; unreadable → `400 file video_unreadable`; a side > 4,096 px → `400 file video_too_large`. Tasks T2, T4.
9. **Codec allow-list** (MED-040, R-S9): H.264, HEVC, VP9, AV1; anything else → `415 unsupported_media_type`. Task T2.
10. **The duration stays the server's `mvhd` read** (MED-013, R-S10); ffmpeg never reads past it. Tasks T3, T7.
11. **A video's crop is measured on its displayed frame** (MED-026, R-S11): rotation applied, from `ffprobe`; the edit copy's even rounding stays within the 1 % tolerance. Task T2.
12. **(changes implemented behaviour) Videos uploaded before plan 7** (MED-030, MED-033, R-S12): shown centred, covering the header, looping their whole file, their stored crop and loop no longer applied; not re-framable (`409 media_not_reframable`), no `source` in their view. Tasks T8, T13.
13. **ffmpeg behind `VideoProcessor`** (MED-041, R-S13): a stub in `test_support` for the route tests; real-ffmpeg tests required (never skipped) on committed fixtures; `FFMPEG_PATH`/`FFPROBE_PATH`; startup check of `-version` and `libx264`. Tasks T3, T4.
14. **Two buckets** (MED-043, MED-044, R-S14): `MEDIA_S3_BUCKET` public, `MEDIA_S3_PRIVATE_BUCKET` private, same endpoint, region and keys; local mode: `private/` under the media directory. Task T5.
15. **(changes implemented behaviour) `MEDIA_STORAGE` absent means `s3`** (MED-009, R-S15); `local` stays selectable; `scripts/check-prod-guard.sh` and every config test fixture set `MEDIA_STORAGE=local`. Task T5.
16. **Distinct media origin checked at startup** (MED-042, R-S16). Task T5.
17. **(changes implemented behaviour) S3 objects carry `Content-Disposition: inline`** (MED-043, R-S17); `nosniff` cannot be stored in S3: plan 5. Task T5.
18. **(changes implemented behaviour) Local `/media/*` adds `Content-Security-Policy: sandbox; default-src 'none'` and `Content-Disposition: inline`** (MED-046, R-S18). Task T6.
19. **No cut-off in S3 mode, plain bucket addresses for the dashboard** (MED-023, MED-024 unchanged, R-S19); plan 5 may add a `forward_auth` in front of the bucket. —
20. **(changes implemented behaviour) CORS on the public bucket for the app origin only** (MED-045, R-S20): configured by the dev and test init; needed by the strip frames of EDI-034 (plan 6's follow-up "S3 bucket CORS" was about the poster capture, which goes). Tasks T9, T15.
21. **Loaders** (PUB-006, PUB-039 to PUB-042, R-S21): surface colour + sheen for image and avatar; error → the loader goes; a mount-time check catches loads finished before hydration; no loader without JavaScript (`<noscript>` style); reduced motion: no blur, no moving sheen. Tasks T13, T14.
22. **Garage v2.5.0 in compose** (R-S22): fixed dev-only key, secret, admin token and RPC secret; `make dev-db` starts Postgres, Garage and the init (no new target). Task T9.
23. **End-to-end tests run in S3 mode only** (R-S23): local mode stays covered by the Rust integration tests. Task T15.
24. **The desktop e2e project uses Google Chrome when Playwright's Chromium cannot decode H.264** (R-S24): measured first in T15. Task T15.
25. **Committed fixtures** (R-S25): backend video fixtures (≤ 300 KB each) and a ~5–6 MB, 24-megapixel e2e photo, each with its ffmpeg command in a README. Tasks T3, T16.
26. **S3 integration tests against the developer's Garage** (R-S26): configured from `MEDIA_S3_*`, required, so `make test` needs `make dev-db`. Task T10.
27. **Editor messages for the new codes** (EDI-037, R-S27). Task T11.
28. **A 4:3 video chosen without the dialog still sends poster time 0.1 s** (R-S28, plan 6's R-S32). Task T12.
29. **Duplicating a card copies its videos' originals** (MED-036, EDI-014, R-S29). Task T8.
30. **The poster box only sets the poster time** (EDI-034, R-S30): `VideoFraming.newPoster` goes; a re-frame always sends the poster time. Task T12.
31. **`duration_seconds` stays the original's duration** (R-S31): the dialog's handles work on the whole video; the served file lasts the loop. Task T7.

The current worktree already holds the uncommitted change of `backend/Cargo.toml` (`[profile.dev.package."*"] opt-level = 3`, owner decision 5): T1 only commits it.

## Global Constraints

- Languages (`CLAUDE.md`): code, identifiers, comments, commits, spec and docs in **English**; interface texts in **French** with accents and French typography in `frontend/web/messages/fr.json` (non-breaking space before `:` `;` `?` `!`, written ` ` in the JSON; typographic apostrophe ’; thousands separated by ` `: `4 096`). `.env.example` keeps its existing language and style (unaccented French comments).
- No business logic in handlers or components: `cartouche-domain` or `frontend/web/src/lib`. A handler reads the request, calls the domain, `db/`, the media and video services, and formats the response. ffmpeg, the clock and storage stay behind their interfaces.
- ffmpeg is only ever run on a temp file the API wrote, as `file:<path>` with `-nostdin -hide_banner -protocol_whitelist file -f mp4` before `-i`, in a temp dir per job (`tempfile::TempDir`), the child spawned with `kill_on_drop(true)`; never a shell, never a path or value from the request on the command line (numbers come from the domain plan, formatted by the adapter). Arguments must work on ffmpeg 5.1 (production image) and newer.
- Every `db/` function on user data takes the owner's ID (ACC-017). Media of another owner → 404 before the body is read.
- Error body `{"error":{"code","message","request_id"}}`. New codes: `video_unreadable`, `video_too_large` (400 field errors on `file`), `video_processing_timeout` (503). Removed: `poster_required`.
- After any route or schema change: `make openapi`, commit `openapi.json` and `schema.d.ts`; a generated-type change that breaks the web build is fixed in the same task. No migration is expected; if one is needed, stop and report.
- Tests: `// spec: XXX-NNN` before each Rust test; the ID in the name of each TypeScript test. Rust: `cd backend && cargo test -p cartouche-domain <filter>` / `cargo test -p cartouche-api --all-features --test it <module>::`. Web: `pnpm -C frontend --filter web exec vitest run <path>`. E2E: `make e2e ARGS="-g '<ids>'"` (one worktree at a time).
- Garage values used in dev and test are dev-only and say so where they are written (compose files, Makefile, `.env.example`).

## Review Focus

1. **A 1920 × 1080, 60 fps H.264 clip with an AAC track and a location tag**, uploaded with crop `{x:0.125, y:0, width:0.75, height:1}` and loop `{start:1, end:3}` → `video.mp4` is 1,280 × 960, H.264 High, `yuv420p`, ≤ 30 fps, 2.0 ± 0.1 s, no audio stream, no `location` tag, `moov` before `mdat`; `source-<token>.mp4` is 960 × 540, whole length; `original.mp4` is in the private store only, byte-identical to the upload. Tests in T3, T7.
2. **A rotated phone clip** (stored 1920 × 1080, display matrix 90°) → probe says 1080 × 1920; a 4:3 crop measured on 1080 × 1920 is accepted; the outputs are upright and carry no rotation. Tests in T2, T3.
3. **A video upload carrying `poster`** → `400 invalid_request`, nothing stored. Tests in T7.
4. **Two video uploads at once** → the second waits; a job past 120 s (stub that sleeps, deadline shortened in the test) → `503 video_processing_timeout`, no file in either store, no ffmpeg process left, the permit free again. Tests in T4, T7.
5. **`GET {MEDIA_PUBLIC_BASE_URL}/cards/<card>/<media>/video.mp4` on the dev Garage** → `content-type: video/mp4`, `cache-control: public, max-age=31536000, immutable`, `content-disposition: inline`; `Range: bytes=0-99` → 206; `Origin: http://localhost:3000` → `access-control-allow-origin: http://localhost:3000`; `Origin: https://evil.example` → none; the original's key is unreachable through the web endpoint. Tests in T10.
6. **`PUBLIC_BASE_URL=https://cartes.example` and `MEDIA_PUBLIC_BASE_URL=https://cartes.example/media`** → the API refuses to start (same origin); `MEDIA_STORAGE` unset and no bucket → refuses to start, naming `MEDIA_S3_BUCKET`. Tests in T5.
7. **Local mode `/media/…/w750.webp`** → `content-security-policy: sandbox; default-src 'none'`, `content-disposition: inline`, `x-content-type-options: nosniff`; `/media/private/cards/…/original.mp4` → 404. Tests in T6.
8. **A plan-6 video** (source `source-<token>.webp`) → the owner's view has no `source`; re-frame → `409 media_not_reframable`; the public page shows it centred, `loop` set, no inline crop style. Tests in T8, T13.
9. **The public page with the header image answered after 1 s** → `aria-busy="true"` and the sheen while waiting, then neither; the same image already cached → the loader is gone after hydration; the image request aborted → no sheen, no busy mark, surface colour; same for the avatar and the video. Tests in T13, T14, T16.
10. **A 24-megapixel, ~6 MB photo** uploaded through the editor in the e2e stack → the crop dialog, then a 4:3 header on the public page within the test's time limit; the dev-build timing is recorded in T19.

---

## File structure

```
backend/domain/src/
  video.rs                 probe checks, codec allow-list, VideoPlan (pixel crop on the displayed frame,
                           served and edit-copy sizes, trim, poster seek), limits
  media.rs                 MAX_VIDEO_BYTES 50 MB
  media_files.rs           edit_copy_name, is_source_name (.webp | .mp4), ORIGINAL_FILE, VIDEO_FILE
backend/server/
  Cargo.toml               tempfile; tokio "process", "fs"
  src/media/video.rs       VideoProcessor trait, VideoProbe/RenderJob/RenderOutputs, Ffmpeg adapter, VideoService
  src/media/service.rs     public + private stores, Content-Disposition, delete in both
  src/config.rs            MEDIA_S3_PRIVATE_BUCKET, default s3, origin check, FFMPEG_PATH, FFPROBE_PATH
  src/main.rs              ffmpeg startup check, VideoService in AppState
  src/state.rs             AppState.video
  src/routes/card_media.rs video upload and re-frame through VideoService, no poster
  src/routes/cards.rs      duplication copies the private original
  src/routes/media_files.rs  CSP sandbox, Content-Disposition
  src/views.rs             MediaView: no source for a legacy video
  src/test_support/video.rs  StubVideoProcessor
  tests/it/video_ffmpeg.rs real ffmpeg on fixtures
  tests/it/media_s3.rs     against the developer's Garage
  tests/fixtures/video/    committed clips + README
  Dockerfile               runtime installs ffmpeg
docker/garage/garage.toml, docker/garage/init.sh
compose.dev.yml, compose.test.yml   garage + garage-init
Makefile, .env.example, README.md, CLAUDE.md, .claude/skills/{dev-env,run-tests}/SKILL.md
scripts/check-prod-guard.sh         MEDIA_STORAGE=local
.github/workflows/ci.yml            ffmpeg + Garage in the api job
frontend/web/
  next.config.ts           56mb, proxyTimeout 180 s
  src/lib/media/upload.ts  no poster, new codes, 50 MB
  src/lib/media/video.ts   capturePoster removed (canvas.ts deleted)
  src/lib/media/framing.ts loopRestart removed
  src/components/editor/MediaField.tsx, crop/VideoCropDialog.tsx
  src/templates/HeaderMedia.tsx        served file as is, reliable loaders
  src/templates/MediaLoader.ts(x)      shared load-state hook (image / video)
  src/templates/classique/Classique.tsx, classique.css   avatar loader, noscript
  messages/fr.json
frontend/e2e/
  fixtures/header-1080p.mp4, fixtures/photo-24mpx.jpg, fixtures/README.md
  fixtures.ts              uploadMedia without poster
  playwright.config.ts     desktop channel (if R-S24 applies)
  tests/media.spec.ts, tests/public-page.spec.ts, tests/media-pipeline.spec.ts
```

---

### Task T1: Commit the dev profile of the dependencies

**Files:** Modify: `backend/Cargo.toml` (already changed in the worktree, uncommitted).

**Rules:** none (owner decision 5; measured in T19).

- [ ] **Step 1:** `git diff backend/Cargo.toml` shows only `[profile.dev.package."*"] opt-level = 3` and its comment; keep the comment (why: unoptimised image decoding took ~118 s on a 24-megapixel photo).
- [ ] **Step 2:** `cd backend && cargo build -p cartouche-api --features test-support` · Expected: builds (first build slower, then incremental builds of the workspace crates stay fast).
- [ ] **Step 3: Commit** — `git commit -m "build(api): optimise dependencies in dev builds"`

**Done:** committed; nothing else changed.

---

### Task T2: Domain — video planning, limits and file names

**Files:**
- Create: `backend/domain/src/video.rs`
- Modify: `backend/domain/src/lib.rs` (module and re-exports), `backend/domain/src/media.rs` (`MAX_VIDEO_BYTES = 50 << 20`), `backend/domain/src/media_files.rs`, `backend/domain/src/framing.rs` (only if a helper must move)

**Rules:** MED-002, MED-003, MED-026, MED-031, MED-034, MED-035, MED-036, MED-037, MED-039, MED-040.

**Interfaces:**
- `media_files.rs`: `pub const VIDEO_FILE: &str = "video.mp4"` (moved from the route), `pub const ORIGINAL_FILE: &str = "original.mp4"`; `edit_copy_name(token) -> String` = `source-<token>.mp4`; `is_source_name` accepts `source-<32 lowercase hex>.webp` **or** `.mp4`; `is_video_source_name(name)` (the `.mp4` form); `served_content_type` returns `video/mp4` for an `.mp4` source name. `original.mp4` is **not** a served name (`served_content_type` → `None`).
- `video.rs`:
  - `pub const MAX_VIDEO_SIDE: u32 = 4096; SERVED_MAX_WIDTH: u32 = 1280; EDIT_COPY_MAX_SIDE: u32 = 960; MIN_VIDEO_CROP_WIDTH: u32 = 16; VIDEO_PROCESSING_DEADLINE: Duration = 120 s`.
  - `pub struct VideoProbe { pub width: u32, pub height: u32, pub codec: String }` — `width`/`height` **as displayed** (the adapter applies the rotation).
  - `pub enum ProbeRejection { UnsupportedCodec, TooLarge }`; `check_probe(&VideoProbe) -> Result<(), ProbeRejection>`: codec in `["h264", "hevc", "vp9", "av1"]` (ffprobe `codec_name`) else `UnsupportedCodec`; either side > 4,096 → `TooLarge` (a zero side never gets here: the adapter reports it `Unreadable`).
  - `served_size(crop_width_px: u32) -> Option<(u32, u32)>`: `w = min(crop_width_px, 1280) / 8 * 8`; `None` when `crop_width_px < 16`; `(w, w * 3 / 4)`.
  - `edit_copy_size(width, height) -> (u32, u32)`: longer side capped at 960, never enlarged, the other side scaled in proportion; both sides then rounded down to an even number (≥ 2).
  - `pub enum PosterSeek { At(f64), LastFrame }`; `poster_seek(poster_time, duration) -> PosterSeek`: `LastFrame` when `poster_time >= duration − 0.05`, else `At(poster_time)`.
  - `pub struct VideoPlan { pub crop: PixelRect, pub output: (u32, u32), pub trim_start: f64, pub trim_length: f64, pub poster: PosterSeek, pub edit_copy: (u32, u32), pub duration: f64 }`; `plan_video(probe, duration, crop: Option<CropRect>, video_loop, poster_time) -> Result<(VideoPlan, CropRect), PlanError>` — default crop (MED-026) on the displayed size when `None`, `check_crop` on the displayed size (`PlanError::Crop`), `crop_pixels` on the displayed size, `served_size` (`PlanError::Crop` when too narrow); `trim_length = loop.end − loop.start`. Returns the crop actually used (to be stored).
- `media.rs`: `MAX_VIDEO_BYTES` 50 MiB; doc comments of the limits updated.

- [ ] **Step 1: Write the failing tests** (inline `#[cfg(test)]` in `video.rs` and `media_files.rs`, `media.rs`)

```rust
// spec: MED-002
fn a_50_mb_video_is_accepted_and_one_byte_more_is_too_large() // classify_upload with a valid mvhd + padding
// spec: MED-031
fn an_edit_copy_name_is_a_source_name_served_as_mp4()          // source-<32 hex>.mp4 → video/mp4; .mov, 31 hex, uppercase → None
// spec: MED-036
fn the_original_is_never_a_served_name()                       // cards/<u>/<u>/original.mp4 → None
// spec: MED-035
fn the_served_file_is_4_3_multiple_of_8_and_never_enlarged()   // 1440 → 1280×960; 480 → 480×360; 1000 → 1000×750; 17 → 16×12; 15 → None
// spec: MED-037
fn the_edit_copy_long_side_is_at_most_960_with_even_sides()    // 1920×1080 → 960×540; 1080×1920 → 540×960; 1366×768 → 960×540; 640×360 → 640×360; 641×361 → 640×360 (even, never enlarged)
// spec: MED-040
fn only_h264_hevc_vp9_and_av1_are_accepted()                   // "mpeg4", "prores", "" → UnsupportedCodec
// spec: MED-039
fn a_side_longer_than_4096_is_too_large()                      // 4096×2160 ok; 4097×2160, 2160×4097 → TooLarge
// spec: MED-026
fn a_video_crop_is_checked_on_the_displayed_frame()            // probe 1080×1920 (rotated): crop {0,0.25,1,0.421875} is 4:3 on it → Ok; the same crop checked on 1920×1080 would be refused
// spec: MED-026
fn without_a_crop_the_video_takes_the_largest_centred_4_3()    // 1920×1080 → crop px 1440×1080 at x=240; output 1280×960
// spec: MED-003
fn the_poster_at_or_past_the_end_is_the_last_frame()           // (2.0, 2s) → LastFrame; (1.96, 2s) → LastFrame; (1.9, 2s) → At(1.9)
// spec: MED-034
fn the_trim_is_the_loop()                                       // loop {1, 3} → trim_start 1, trim_length 2
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-domain video media_files media::` · Expected: FAIL (missing items).
- [ ] **Step 3: Implement.** Keep `is_source_key` working for both forms; the API crate still compiles (`VIDEO_FILE` now imported from the domain; `MAX_VIDEO_BYTES` change only moves the multipart limit).
- [ ] **Step 4: Run and see them pass** — same command, then `cargo test -p cartouche-domain && cargo clippy --workspace --all-features -- -D warnings` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(domain): plan header video transcodes, edit copies and limits"`

**Done:** every rule above cited by at least one domain test; no ffmpeg knowledge (argument strings) in the domain.

---

### Task T3: `VideoProcessor` and the ffmpeg adapter, tested on real files

Depends on T2.

**Files:**
- Create: `backend/server/src/media/video.rs`, `backend/server/tests/it/video_ffmpeg.rs`, `backend/server/tests/fixtures/video/README.md` and the fixtures below
- Modify: `backend/server/src/media/mod.rs`, `backend/server/Cargo.toml` (`tempfile = "3.27"`; tokio features `process`, `fs`), `backend/Cargo.lock`, `backend/server/tests/it/main.rs` (`mod video_ffmpeg;`), `.github/workflows/ci.yml` (`api` job: `sudo apt-get update && sudo apt-get install -y --no-install-recommends ffmpeg` before the tests, so that the branch's CI stays green)

**Rules:** MED-034, MED-035, MED-037, MED-038, MED-026 (rotation), MED-003 (frame extraction), MED-039 (`video_unreadable`).

**Interfaces:**
- ```rust
  #[async_trait]
  pub trait VideoProcessor: Send + Sync {
      /// Displayed size (rotation applied) and codec of the first video stream.
      async fn probe(&self, input: &Path) -> Result<VideoProbe, VideoError>;
      /// Writes the served file, the edit copy when asked, and the full displayed frame at the poster seek (PNG) into `job.out_dir`.
      async fn render(&self, job: &RenderJob) -> Result<RenderOutputs, VideoError>;
  }
  pub struct RenderJob { pub input: PathBuf, pub out_dir: PathBuf, pub plan: VideoPlan, pub edit_copy: bool }
  pub struct RenderOutputs { pub served: PathBuf, pub edit_copy: Option<PathBuf>, pub poster_frame: PathBuf }
  pub enum VideoError { Unreadable(String), Tool(String) } // Tool: the program could not be run (missing binary, spawn failure)
  pub struct Ffmpeg { ffmpeg: PathBuf, ffprobe: PathBuf }
  ```
- `probe`: `ffprobe -v error -hide_banner -protocol_whitelist file -f mp4 -select_streams v:0 -show_entries stream=codec_name,width,height:stream_side_data=rotation -of json file:<input>`; a ±90°/270° rotation swaps width and height; no stream, zero size or non-zero exit → `Unreadable`.
- `render`: one ffmpeg run for the served file and the edit copy (one decode, `split` in a `-filter_complex`): served branch `trim=start=…:duration=…,setpts=PTS-STARTPTS,crop=W:H:X:Y,scale=w:h` → `-map "[served]" -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 26 -preset medium -fpsmax 30 -an -map_metadata -1 -movflags +faststart video.mp4`; edit branch `scale=w:h` → `-crf 30 -preset veryfast` with the same `-an -map_metadata -1 -movflags +faststart -fpsmax 30 -pix_fmt yuv420p`; input bounded with `-t <plan.duration>`; then a second, short run for the poster: `-ss <t>` (or `-sseof -0.5 … -update 1` for `LastFrame`) `-frames:v 1` → `poster.png` at the full displayed size. Autorotation stays on (default) and the outputs carry no rotation side data. Every child: `Command::new(path)`, `kill_on_drop(true)`, `stdin(null)`, stderr captured (last lines logged at `warn` on failure, never returned to the client).
- Fixtures (generated once with ffmpeg 8 on the Mac, commands in the README, each ≤ 300 KB): `landscape-1080p60-audio-gps.mp4` (1920 × 1080, 60 fps, 4 s, H.264 + AAC, `-metadata location=+48.8566+002.3522/`), `portrait-rotated.mp4` (1920 × 1080 coded, `-display_rotation 90`, 3 s), `small-640x360-24fps.mp4` (VP9 in MP4, 24 fps, 2 s), `no-video-stream.mp4` (AAC only, `isom` brand), `truncated.mp4` (the first 4 KB of the landscape clip).
- The real-ffmpeg tests read `FFMPEG_PATH`/`FFPROBE_PATH` from the environment, default `ffmpeg`/`ffprobe`; they are **not** skipped when ffmpeg is missing: they fail with "install ffmpeg (brew install ffmpeg / apt-get install ffmpeg)".

- [ ] **Step 1: Write the failing tests** (`tests/it/video_ffmpeg.rs`; outputs inspected with `ffprobe -show_streams -show_format -of json`, `moov`/`mdat` order read from the top-level boxes)

```rust
// spec: MED-039
async fn probe_reports_the_displayed_size_and_codec()           // landscape → 1920×1080 h264; portrait-rotated → 1080×1920
// spec: MED-039
async fn an_unreadable_file_is_reported_unreadable()             // truncated.mp4, no-video-stream.mp4 → Unreadable
// spec: MED-034, MED-035
async fn the_served_file_is_the_cropped_loop_in_h264()           // landscape, crop default, loop {1,3}: 1280×960, h264 High, yuv420p, ≤30 fps, 2.0±0.1 s, moov before mdat
// spec: MED-038
async fn the_served_file_and_edit_copy_have_no_sound_nor_metadata() // no audio stream; no "location" format tag; one stream each
// spec: MED-037
async fn the_edit_copy_is_the_whole_video_at_960()               // landscape → 960×540, 4.0±0.1 s
// spec: MED-035, MED-037
async fn a_small_video_is_never_enlarged()                       // small 640×360 24 fps → served 480×360 at 24 fps; edit copy 640×360
// spec: MED-026
async fn a_rotated_video_comes_out_upright()                     // portrait-rotated, crop 4:3 on 1080×1920 → served 1080×810 (1,080 is a multiple of 8), no rotation side data
// spec: MED-003
async fn the_poster_frame_is_the_full_frame_at_the_poster_time() // At(1.0) → PNG 1920×1080; LastFrame → PNG decoded, not empty
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-api --all-features --test it video_ffmpeg::` · Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `media/video.rs` (trait, types, `Ffmpeg`). Argument building stays in the adapter; every number comes from `VideoPlan`.
- [ ] **Step 4: Run and see them pass** — same command; then `cargo clippy --workspace --all-features -- -D warnings` · Expected: PASS. Also run the probe and render once inside a `debian:bookworm-slim` container with its ffmpeg 5.1 (`docker run --rm -v "$PWD/backend/server/tests/fixtures/video:/v" debian:bookworm-slim sh -c "apt-get update -qq && apt-get install -y -qq ffmpeg >/dev/null && ffmpeg …"` with the exact arguments the adapter logs at `debug`) and note the result in the follow-ups (execution ruling) — the e2e of T15 then exercises 5.1 for real.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): ffmpeg adapter for header video transcodes and frames"`

**Done:** the trait is the only way the API runs ffmpeg; the eight tests pass on the Mac.

---

### Task T4: Video service — one job at a time, one deadline, startup check, image with ffmpeg

Depends on T3.

**Files:**
- Modify: `backend/server/src/media/video.rs` (`VideoService`), `backend/server/src/state.rs` (`pub video: VideoService`), `backend/server/src/config.rs` (`video: VideoToolsConfig { ffmpeg: PathBuf, ffprobe: PathBuf }` from `FFMPEG_PATH`/`FFPROBE_PATH`), `backend/server/src/main.rs` (check, then build), `backend/server/src/test_support/mod.rs` + Create `backend/server/src/test_support/video.rs` (`StubVideoProcessor`), `backend/server/tests/it/common/mod.rs` (`test_state` uses the stub), `backend/Dockerfile` (runtime `apt-get install -y --no-install-recommends ffmpeg`), every place that builds an `AppState`

**Rules:** MED-039, MED-041.

**Interfaces:**
- `VideoService::new(processor: Arc<dyn VideoProcessor>, permits: usize, deadline: Duration)`; production: `(Ffmpeg, 1, VIDEO_PROCESSING_DEADLINE)`. `async fn run<T>(&self, work: impl FnOnce(Arc<dyn VideoProcessor>) -> BoxFuture<'static, Result<T, VideoError>>) -> Result<T, VideoJobError>` where `VideoJobError = { Timeout, Video(VideoError) }`. The work runs in a spawned task that owns its permit, the temp dir and the child processes; the deadline starts **before** the permit is awaited; at the deadline the task kills its child and waits for it before giving the permit back; a dropped request does not cancel the task (it ends by itself or at the deadline), like the image limiter.
- `Ffmpeg::check(&self) -> Result<(), String>`: `ffmpeg -version` and `ffprobe -version` run, `ffmpeg -hide_banner -encoders` lists `libx264`; the message names the variable and says "install ffmpeg: brew install ffmpeg (macOS) or apt-get install ffmpeg (Debian/Ubuntu), or set FFMPEG_PATH and FFPROBE_PATH". `main` calls it before binding and exits with failure on error (logged).
- `StubVideoProcessor` (feature `test-support`): `probe` returns a configurable `VideoProbe` (default 1920 × 1080 `h264`) or a configured error; `render` writes `served` and `edit copy` files whose bytes name the plan (`served 1280x960 trim 1.000+2.000`), and a real PNG gradient of the probe's displayed size for the poster frame; optional delay (`tokio::time::sleep`) for the timeout tests; records the jobs it saw.

- [ ] **Step 1: Write the failing tests** (unit tests in `media/video.rs`, config tests in `config.rs`)

```rust
// spec: MED-039
async fn a_second_job_waits_for_the_first()                     // 1 permit, stub delayed 200 ms: second starts after first ends
// spec: MED-039
async fn a_job_past_the_deadline_is_a_timeout_and_frees_its_permit() // deadline 100 ms, stub sleeps 1 s → Timeout; available_permits back to 1
// spec: MED-039
async fn the_wait_counts_in_the_deadline()                      // deadline 300 ms, first job 1 s: the second times out without running
// spec: MED-041
async fn the_check_names_a_missing_ffmpeg()                     // FFMPEG_PATH=/nonexistent → Err containing "FFMPEG_PATH" and "brew install ffmpeg"
// spec: MED-041
async fn the_check_accepts_the_installed_ffmpeg()               // default paths → Ok (requires ffmpeg, like T3)
// spec: MED-041
fn ffmpeg_paths_default_to_the_path_and_follow_the_variables()  // config: absent → "ffmpeg"/"ffprobe"; set → the given paths
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-api --all-features --lib media::video config::` · Expected: FAIL.
- [ ] **Step 3: Implement.** `make api` now needs ffmpeg on the host.
- [ ] **Step 4: Run and see them pass** — same command, then `cargo test --workspace --all-features` (everything still green: the routes do not use the service yet) and `docker build -f backend/Dockerfile --build-arg FEATURES=test-support -t cartouche-api:t4 . && docker run --rm --entrypoint ffmpeg cartouche-api:t4 -hide_banner -encoders | grep libx264` · Expected: PASS, `libx264` listed.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): bounded video jobs and an ffmpeg check at startup"`

**Done:** `make e2e` still starts (the test image has ffmpeg); the startup log line names the ffmpeg version.

---

### Task T5: Media service — public and private stores, stored headers, S3 by default, distinct origin

Independent of T3/T4.

**Files:**
- Modify: `backend/server/src/media/service.rs`, `backend/server/src/media/mod.rs`, `backend/server/src/config.rs`, `backend/server/src/startup.rs` (`describe_media_storage` names both buckets), `backend/server/tests/it/media_service.rs`, `backend/server/tests/it/common/failing_store.rs` (if `with_store` changes), `scripts/check-prod-guard.sh` (`-e MEDIA_STORAGE=local` on both `docker create`/`docker run`), `Makefile` (interim `MEDIA_STORAGE ?= local` so that `make api` keeps working until T9), every config test fixture (`MEDIA_STORAGE=local` where a test does not care about storage)

**Rules:** MED-009, MED-011, MED-016, MED-018, MED-019, MED-042, MED-043, MED-044.

**Interfaces:**
- `MediaStorageConfig::S3 { bucket, private_bucket, region, endpoint, access_key_id, secret_access_key, public_base_url }`; `MEDIA_S3_PRIVATE_BUCKET` required in S3 mode; `MEDIA_STORAGE` absent → `S3`; `local` → `Local`; the origin check (`Url::origin()` of `MEDIA_PUBLIC_BASE_URL` equal to that of `PUBLIC_BASE_URL`) → `ConfigError::Invalid("MEDIA_PUBLIC_BASE_URL", "must be served from another origin than PUBLIC_BASE_URL")`; the private bucket equal to the public one → invalid too.
- `MediaService { public: Arc<dyn ObjectStore>, private: Arc<dyn ObjectStore>, … }`: `put` (public, with `ContentType`, `CacheControl`, `ContentDisposition: inline` in S3 mode), `put_private(key, bytes)`, `get_private(key, range)`, `copy_private(from, to)`, `delete_media` and `delete_card` delete under the prefix in **both** stores. Local: `private = PrefixStore::new(local, "private")`, so private keys live under `<dir>/private/cards/…`. `in_memory`/`in_memory_remote` get two `InMemory` stores; `with_store` becomes `with_stores(public, private, base, serves_locally)`. `list_keys` (tests) lists the public store; add `list_private_keys`.

- [ ] **Step 1: Write the failing tests** (`config.rs` unit tests; `service.rs` unit tests; `tests/it/media_service.rs`)

```rust
// spec: MED-009
fn media_storage_is_s3_by_default_and_local_on_demand()         // absent → missing MEDIA_S3_BUCKET; "local" → Local; "s3" with all vars → S3 incl. private_bucket
// spec: MED-044
fn s3_requires_a_private_bucket_distinct_from_the_public_one()  // missing → Missing("MEDIA_S3_PRIVATE_BUCKET"); equal → Invalid
// spec: MED-042
fn the_media_origin_must_differ_from_the_app_origin()           // https://cartes.example vs https://cartes.example/media → Invalid; :8443 or media.cartes.example → Ok
// spec: MED-043
fn s3_files_are_stored_inline_with_their_type_and_cache()       // object_attributes: ContentDisposition "inline" + the existing two
// spec: MED-044
async fn private_files_never_reach_the_public_store()           // put_private → list_keys has none, list_private_keys has it; local mode: file under <dir>/private/cards/…
// spec: MED-018, MED-019
async fn deleting_a_media_or_a_card_empties_both_stores()       // public + private keys under cards/<card>/<media> → gone after delete_media; same for delete_card
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-api --all-features --lib config:: media:: && cargo test -p cartouche-api --all-features --test it media_service::` · Expected: FAIL.
- [ ] **Step 3: Implement.** Then run `bash scripts/check-prod-guard.sh` (Docker) · Expected: PASS (with `MEDIA_STORAGE=local` the guard still sees `TestIssuerInProduction` and the 404).
- [ ] **Step 4: Run and see them pass** — the commands of step 2, then `cargo test --workspace --all-features` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): private media store, inline S3 objects and S3 storage by default"`

**Done:** `make api` still starts in local mode (interim Makefile default); the prod guard passes.

---

### Task T6: Local `/media/*` headers

Independent (after T2 for the `.mp4` source name).

**Files:** Modify: `backend/server/src/routes/media_files.rs`, `backend/server/tests/it/media.rs` (or a new `media_files` section in it)

**Rules:** MED-046, MED-031, MED-044.

- [ ] **Step 1: Write the failing tests** (`#[sqlx::test]`, local in-memory media)

```rust
// spec: MED-046
async fn local_media_responses_are_sandboxed_and_inline()       // 200, 206 and 416 responses: content-security-policy "sandbox; default-src 'none'", content-disposition "inline", x-content-type-options "nosniff"
// spec: MED-031
async fn an_edit_copy_needs_a_signature_even_on_a_served_card() // source-<token>.mp4 unsigned → 404; signed → 200 video/mp4, Range → 206
// spec: MED-044
async fn private_keys_are_never_served()                        // /media/private/cards/<c>/<m>/original.mp4 and /media/cards/<c>/<m>/original.mp4 → 404, signed or not
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-api --all-features --test it media::` · Expected: FAIL (headers missing).
- [ ] **Step 3: Implement** (two headers added in `response()`; the key grammar already refuses the rest).
- [ ] **Step 4: Run and see them pass** — same command · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): sandbox local media responses"`

---

### Task T7: Video upload through the server — transcode, edit copy, original, placeholder

Depends on T2, T4, T5.

**Files:**
- Modify: `backend/server/src/routes/card_media.rs`, `backend/server/src/error.rs` (`ApiError::VideoProcessingTimeout` → 503 `video_processing_timeout`), `backend/server/src/media/process.rs` (a variant-only entry for the extracted frame if needed: the frame is produced by the API, it must not hit the 10 MB upload limit), `backend/server/src/views.rs` (doc comments: `video_url` is the served transcode, `source` is the edit copy for a video), `backend/server/tests/it/media.rs`, `backend/server/tests/it/media_processing.rs`, `backend/server/tests/it/openapi.rs` (only if a snapshot lists codes), `frontend/api-client/openapi.json`, `frontend/api-client/src/schema.d.ts` (generated)

**Rules:** MED-002, MED-003, MED-004, MED-013, MED-025, MED-029, MED-034, MED-036, MED-037, MED-039, MED-040.

**Interfaces:**
- `read_form`: the `poster` name is unknown → `400 invalid_request` (the existing `_ =>` arm); `file` limit `MAX_VIDEO_BYTES`; `UPLOAD_BODY_LIMIT = 52 << 20`.
- Video branch of `prepare`: `classify_upload` (MED-022, MED-013, 50 MB) → `check_video_framing` → `state.video.run(…)`: write the bytes to `<tmp>/input.mp4`, `probe`, `check_probe` (`UnsupportedCodec` → 415, `TooLarge` → `file`/`video_too_large`), `plan_video` (`Crop` → `crop`/`invalid_crop`), `render { edit_copy: true }`, read the three outputs → `prepare_image(poster_frame, Header, Some(crop))` (keep only the variants: a video stores **no** `.webp` source any more) → files: public `w750/w1125/w1440.webp`, `video.mp4`, `source-<token>.mp4`; private `original.mp4` (the uploaded bytes). `VideoError::Unreadable` → `file`/`video_unreadable`; `VideoError::Tool` → 500; `Timeout` → 503.
- `SourceFile { name: edit_copy_name(token), width, height }` = the edit copy's size; `duration_ms` = the `mvhd` duration (R-S31); `Framing { crop, loop, poster_time }` as stored today.
- `store()`: puts public files, then the private original; on any failure `discard_files` deletes in both stores (T5).
- OpenAPI: `UploadMediaBody` loses `poster`; `file` says "MP4 video (50 MB, 30 s at most)"; the 400 description lists `video_unreadable`, `video_too_large`, no `poster_required`; 413 says 50 MB; 415 mentions an unsupported video codec; 503 adds `video_processing_timeout`. `make openapi`.

- [ ] **Step 1: Write the failing tests** (`tests/it/media.rs`, stub video processor; rewrite the video tests that send a `poster` part)

```rust
// spec: MED-003
async fn a_video_upload_with_a_poster_part_is_refused()          // 400 invalid_request, list_keys and list_private_keys empty
// spec: MED-004, MED-034, MED-037
async fn a_video_upload_stores_the_transcode_the_edit_copy_and_the_placeholder() // public: video.mp4 (stub bytes name 1280x960 + trim), source-<32hex>.mp4, w750/w1125/w1440.webp; no .webp source
// spec: MED-036
async fn the_uploaded_file_is_kept_privately_as_is()             // private original.mp4 == uploaded bytes; not in list_keys
// spec: MED-029, MED-003
async fn the_placeholder_is_cut_from_the_frame_at_the_poster_time() // stub saw PosterSeek::At(1.5); w1440 is 1440×1080
// spec: MED-025, MED-031
async fn the_owner_view_gives_the_edit_copy_as_source()          // source.url ends with .mp4 (signed in local mode), width/height = stub edit copy size; public view has no source
// spec: MED-002
async fn a_video_above_50_mb_is_too_heavy()                      // 50 MiB + 1 → 413 payload_too_large
// spec: MED-039
async fn an_unreadable_video_is_refused_on_its_file_field()      // stub probe Unreadable → 400 [{file, video_unreadable}], nothing stored
// spec: MED-039
async fn a_video_wider_than_4096_is_refused()                    // stub probe 4100×2000 → 400 [{file, video_too_large}]
// spec: MED-040
async fn an_unsupported_codec_is_refused()                       // stub probe codec "mpeg4" → 415 unsupported_media_type
// spec: MED-039
async fn a_video_job_past_its_deadline_is_a_503_and_stores_nothing() // service with 100 ms deadline + delayed stub → 503 video_processing_timeout; both stores empty
// spec: MED-035
async fn a_crop_narrower_than_16_pixels_is_refused()             // 400 [{crop, invalid_crop}]
// spec: MED-013
async fn a_video_longer_than_30_s_is_refused_before_processing() // video_too_long; the stub saw no job
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-api --all-features --test it media::` · Expected: FAIL.
- [ ] **Step 3: Implement**, then `make openapi` (regenerates `openapi.json` and `schema.d.ts`) and `pnpm -C frontend -r typecheck` (the web still compiles: `uploadMedia` is hand-written; fix in this task anything the generated types break).
- [ ] **Step 4: Run and see them pass** — `cargo test --workspace --all-features` · Expected: PASS (OpenAPI drift test included).
- [ ] **Step 5: Commit** — `git commit -m "feat(api): transcode header videos on upload, keep the original privately"`

**Done:** no route code calls ffmpeg directly; the handler stays a sequence of domain, service and `db/` calls.

---

### Task T8: Video re-frame from the original, duplication, videos uploaded before plan 7

Depends on T7.

**Files:** Modify: `backend/server/src/routes/card_media.rs` (`prepare_reframed`), `backend/server/src/routes/cards.rs` (`MediaCopy::file_keys` + private original), `backend/server/src/views.rs` (`MediaView::new`), `backend/server/tests/it/media.rs`, `backend/server/tests/it/card_actions.rs` (duplication), `backend/server/tests/it/admin_cards.rs` (support view: still no source), `frontend/api-client/*` (regenerated)

**Rules:** MED-030, MED-031, MED-033, MED-036, EDI-014, LNK-036 (unchanged refusal, re-run).

**Interfaces:**
- Re-frame of a video: `crop` required (as today); a `poster` part → `400 invalid_request`; the previous media's `source` must be an `.mp4` name and its private `original.mp4` must exist, else `409 media_not_reframable`; `get_private(original)` → temp file → `VideoService` with `edit_copy: false` → new `video.mp4` + placeholder variants; copies: edit copy (public, under a **new** `source-<token>.mp4` name) and original (`copy_private` to the new media id). The previous media's files are untouched (MED-016).
- Duplication: for a media whose `source` is an `.mp4` name, `copy_private(original)` to the copy's id; a failure removes what was copied in both stores.
- `MediaView::new`: `source` is `None` for a `Video` whose source is not an `.mp4` name (plan-6 videos) — for every audience.

- [ ] **Step 1: Write the failing tests**

```rust
// spec: MED-030, MED-036
async fn re_framing_a_video_transcodes_its_original_again()      // new media id; stub saw the original's bytes, new loop and poster time; new video.mp4; old files byte-identical
// spec: MED-031
async fn a_re_framed_video_keeps_its_edit_copy_under_a_new_name() // same bytes, different token; old one untouched
// spec: MED-003
async fn a_re_frame_with_a_poster_part_is_refused()               // 400 invalid_request
// spec: MED-030, MED-033
async fn a_video_uploaded_before_plan_7_cannot_be_re_framed()     // record with source-<t>.webp → 409 media_not_reframable; owner view has no source
// spec: MED-030
async fn a_video_whose_original_is_missing_cannot_be_re_framed()  // original deleted from the private store → 409
// spec: MED-036, EDI-014
async fn duplicating_a_card_copies_its_video_original()           // the copy's private original exists, equal bytes; the copy can be re-framed
// spec: MED-018
async fn saving_away_a_re_framed_video_deletes_its_private_original() // after the save that attaches the new media, the old media's original is gone
```

- [ ] **Step 2: Run and see them fail** — `cd backend && cargo test -p cartouche-api --all-features --test it media:: card_actions:: admin_cards::` · Expected: FAIL.
- [ ] **Step 3: Implement**; `make openapi` (re-frame body without `poster`; 409 description adds "a video uploaded before plan 7").
- [ ] **Step 4: Run and see them pass** — `cargo test --workspace --all-features` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): re-frame header videos from their original"`

---

### Task T9: Garage in compose for development, init script, Makefile and `.env.example`

Depends on T5.

**Files:**
- Create: `docker/garage/garage.toml`, `docker/garage/init.sh`
- Modify: `compose.dev.yml`, `Makefile`, `.env.example`, `.gitignore` (if a Garage data dir is ever bind-mounted; prefer a named volume)

**Rules:** MED-009, MED-045 (configured here, tested in T10), MED-044 (private bucket has no website access).

**Interfaces:**
- `garage.toml` (dev-only secrets, says so in a comment): `replication_factor = 1`, `db_engine = "sqlite"`, `metadata_dir`/`data_dir` under `/var/lib/garage`, `rpc_bind_addr = "[::]:3901"`, a fixed `rpc_secret`, `[s3_api] s3_region = "garage"`, `api_bind_addr = "[::]:3900"`, `[s3_web] bind_addr = "[::]:3902"`, `root_domain = ".web.garage.localhost"`, `[admin] api_bind_addr = "[::]:3903"`, a fixed `admin_token`. Check every key against the Garage v2.5.0 reference before writing it.
- `compose.dev.yml`: `garage` (`dxflrs/garage:v2.5.0`, command `/garage server --single-node --default-bucket`, env `GARAGE_DEFAULT_ACCESS_KEY` (`GK` + 24 hex), `GARAGE_DEFAULT_SECRET_KEY` (64 hex), `GARAGE_DEFAULT_BUCKET=cartouche-media`, the config mounted read-only, a named volume `cartouche-dev-garage`, ports `127.0.0.1:${DEV_S3_PORT:-3900}:3900`, `127.0.0.1:${DEV_S3_WEB_PORT:-3902}:3902`, `127.0.0.1:${DEV_S3_ADMIN_PORT:-3903}:3903`, a healthcheck on the admin API); `garage-init` (`curlimages/curl`, runs `docker/garage/init.sh`, `depends_on: garage: service_healthy`, `restart: "no"`), env: admin URL, admin token, S3 URL, key, secret, `PUBLIC_BUCKET=cartouche-media`, `PRIVATE_BUCKET=cartouche-media-private`, `APP_ORIGIN=${PUBLIC_BASE_URL:-http://localhost:3000}`.
- `init.sh` (POSIX `sh`, `set -eu`, idempotent — a second run changes nothing and exits 0): wait for the admin API; `GET /v2/GetBucketInfo?globalAlias=$PRIVATE_BUCKET` or `POST /v2/CreateBucket`; `POST /v2/AllowBucketKey` (read, write) on the private bucket; public bucket: `POST /v2/UpdateBucket?id=… {"websiteAccess":{"enabled":true,"indexDocument":"index.html"}}`, `POST /v2/AddBucketAlias {"globalAlias":"localhost"}` (an "already exists" answer is success); `PUT /<public>?cors` with `curl --aws-sigv4 "aws:amz:garage:s3" --user KEY:SECRET`: one rule, `AllowedOrigin` = `$APP_ORIGIN`, `AllowedMethod` GET and HEAD, `AllowedHeader` `*`, `ExposeHeader` `Content-Length`, `Content-Range`, `Accept-Ranges`, `MaxAgeSeconds` 3600. The private bucket never gets website access.
- `Makefile`: `DEV_S3_PORT ?= 3900`, `DEV_S3_WEB_PORT ?= 3902`, `DEV_S3_ADMIN_PORT ?= 3903`, `MEDIA_STORAGE ?= s3` (replaces T5's interim `local`), `MEDIA_S3_BUCKET ?= cartouche-media`, `MEDIA_S3_PRIVATE_BUCKET ?= cartouche-media-private`, `MEDIA_S3_REGION ?= garage`, `MEDIA_S3_ENDPOINT ?= http://localhost:$(DEV_S3_PORT)`, the dev key and secret, `MEDIA_PUBLIC_BASE_URL ?= http://localhost:$(DEV_S3_WEB_PORT)`; `dev-db` comment: starts Postgres, Garage and its init. `MEDIA_LOCAL_DIR` stays (local mode).
- `.env.example`: the media section rewritten: `s3` by default (Garage of `make dev-db`), the dev values commented as dev-only, `MEDIA_S3_PRIVATE_BUCKET`, `DEV_S3_PORT`/`DEV_S3_WEB_PORT`/`DEV_S3_ADMIN_PORT` (one set per worktree, like `DEV_DB_PORT`), `MEDIA_STORAGE=local` as the alternative (needed to try the dev site from a phone on the LAN: the bucket's `localhost` address is not reachable from the phone), OVH Object Storage example for `MEDIA_S3_ENDPOINT`/`MEDIA_S3_REGION` (`https://s3.<region>.io.cloud.ovh.net`, region e.g. `gra` — plan 5 confirms), `FFMPEG_PATH`/`FFPROBE_PATH`.

- [ ] **Step 1: Write the failing check** — a shell check run by hand (no test framework for compose): `make dev-db && curl -fsS -o /dev/null -w '%{http_code}' http://localhost:$DEV_S3_WEB_PORT/` · Expected before: connection refused.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Check** — `make dev-db` (twice: the init is idempotent) · then `docker compose -f compose.dev.yml ps` (garage healthy, garage-init exited 0) · `make api` in local terminal: the startup log says `s3:cartouche-media+cartouche-media-private@garage` · upload a photo through `make web` and open the public page: the image comes from `http://localhost:$DEV_S3_WEB_PORT/cards/…` · `curl -sI -H 'Origin: http://localhost:3000' <that url>` shows `access-control-allow-origin: http://localhost:3000` · Expected: all true.
- [ ] **Step 4: Commit** — `git commit -m "build: Garage S3 storage for development"`

**Done:** a fresh clone with `make setup dev-db api web` uses S3; `docker compose -f compose.dev.yml down -v && make dev-db` starts from scratch.

---

### Task T10: S3 integration tests against Garage

Depends on T5, T7, T9.

**Files:** Create: `backend/server/tests/it/media_s3.rs`; Modify: `backend/server/tests/it/main.rs` (`mod media_s3;`), `backend/server/tests/it/common/mod.rs` (`s3_media_from_env()`), `.github/workflows/ci.yml` (`api` job: start Garage and its init from `compose.dev.yml` at the repo root — `docker compose -f compose.dev.yml up -d --wait garage`, then the init; job `env`: `MEDIA_STORAGE`, `MEDIA_S3_*`, `MEDIA_PUBLIC_BASE_URL=http://localhost:3902`, `PUBLIC_BASE_URL=http://localhost:3000`, mirroring the Makefile defaults; the `postgres` service stays)

**Rules:** MED-009, MED-016, MED-017, MED-018, MED-019, MED-031, MED-043, MED-044, MED-045.

**Interfaces:**
- `s3_media_from_env() -> MediaService`: builds `MediaStorageConfig::S3` from `MEDIA_S3_*` and `MEDIA_PUBLIC_BASE_URL` (the Makefile exports them for `make test`); a missing variable or an unreachable endpoint panics with "start the development storage: make dev-db". The app origin for CORS is `PUBLIC_BASE_URL` (default `http://localhost:3000`). Every test works under a fresh random card id and only ever lists `cards/<that id>`; it deletes what it wrote.
- HTTP checks use `reqwest` (already a dependency) against `MEDIA_PUBLIC_BASE_URL`; the private bucket is probed on the web endpoint with `Host: cartouche-media-private` and through its would-be public URL.

- [ ] **Step 1: Write the tests** (they fail until the init of T9 and the service of T5 are right)

```rust
// spec: MED-043, MED-016
async fn public_files_are_served_with_their_type_cache_and_inline()  // webp, jpg, mp4: content-type, cache-control immutable, content-disposition inline
// spec: MED-017
async fn the_bucket_answers_range_requests()                          // bytes=0-99 → 206, content-range bytes 0-99/<size>, 100 bytes
// spec: MED-045
async fn the_bucket_allows_the_app_origin_only()                      // Origin app → ACAO app; Origin https://evil.example → no ACAO
// spec: MED-044
async fn the_private_bucket_is_not_served()                           // put_private → web endpoint 404 by URL and by Host
// spec: MED-018, MED-019
async fn deletes_reach_both_buckets()                                 // delete_media, delete_card → head NotFound in both
// spec: MED-043
async fn a_copied_file_keeps_its_headers()                            // copy (re-frame, duplication) → same three headers on the copy
// spec: MED-009, MED-031
async fn an_upload_on_s3_is_served_by_the_bucket()                    // #[sqlx::test] TestApp on s3_media_from_env + stub video: video upload → video_url, edit copy and images answer 200 from the bucket; the original is only in the private bucket
```

- [ ] **Step 2: Run** — `make dev-db && cd backend && cargo test -p cartouche-api --all-features --test it media_s3::` (from the repo root through `make test-api` the variables are exported; outside `make`, export them from the Makefile defaults) · Expected: PASS; with Garage stopped: FAIL with the "make dev-db" message.
- [ ] **Step 3: Commit** — `git commit -m "test(api): media storage against the development S3"`

---

### Task T11: Web — limits, error messages, proxy limits

Depends on T7 (codes exist).

**Files:** Modify: `frontend/web/src/lib/media/upload.ts`, `frontend/web/src/lib/media/upload.test.ts`, `frontend/web/messages/fr.json`, `frontend/web/next.config.ts`, plus a test for the config values (e.g. `frontend/web/next.config.test.ts` reading the exported object, or an assertion in an existing build-profile test)

**Rules:** MED-002, EDI-037.

**Interfaces:**
- `MAX_VIDEO_BYTES = 50 * 1024 * 1024`; `mediaErrorKey`: `video_unreadable`, `video_too_large` (field `file`), `video_processing_timeout` (top-level code) map to their keys; `poster_required` and the `poster` field disappear from the lists.
- `fr.json` `editor.media.errors`: `video_unreadable`: "Cette vidéo ne peut pas être lue : essaie un autre fichier MP4", `video_too_large`: "Cette vidéo est trop grande (4 096 pixels de côté au plus)", `video_processing_timeout`: "La préparation de la vidéo a pris trop de temps : réessaie dans un instant", `too_large` and `payload_too_large`: "Ce fichier est trop lourd (10 Mo pour une image, 50 Mo pour une vidéo)"; `poster_required` removed.
- `next.config.ts`: `proxyClientMaxBodySize: "56mb"`, `proxyTimeout: 180_000` under `experimental` (check the option name in Next 16's `experimental` type; the comment says why: a video upload waits for its transcode, MED-039, plus its transfer).

- [ ] **Step 1: Write the failing tests**

```ts
test("MED-002 a video up to 50 MB is accepted before upload and a heavier one is refused", …);
test("EDI-037 video_unreadable, video_too_large and video_processing_timeout have their own message", …); // mediaErrorKey + key exists in fr.json
test("EDI-037 the too-heavy message says 50 Mo for a video", …);
test("MED-002 the web proxy lets a 50 MB upload through and waits for its processing", …);            // 56mb, 180 000 ms
```

- [ ] **Step 2: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/lib/media/upload` (+ the config test) · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass** — same, then `pnpm -C frontend -r typecheck && pnpm -C frontend -r lint` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): 50 MB videos and messages for refused videos"`

---

### Task T12: Web — no browser poster, re-frame a video from its edit copy

Depends on T8, T11.

**Files:**
- Modify: `frontend/web/src/lib/media/upload.ts` (`UploadMedia = (slot, file, framing?)`, `ReframeMedia = (mediaId, framing)`, no `poster` part), `frontend/web/src/lib/media/video.ts` (delete `capturePoster`, `POSTER_MAX_WIDTH`; keep `readVideoInfo`, `captureFrames`, `POSTER_SECONDS`, `VIDEO_LOAD_TIMEOUT_MS`), delete `frontend/web/src/lib/media/canvas.ts` (no other user), `frontend/web/src/components/editor/MediaField.tsx`, `frontend/web/src/components/editor/crop/VideoCropDialog.tsx` (`VideoFraming` without `newPoster`), `frontend/web/src/components/editor/CardEditor.tsx` (bindings), their tests (`MediaField.test.tsx`, `VideoCropDialog.test.tsx`, `video.test.ts`, `upload.test.ts`)

**Rules:** MED-003, MED-021, MED-030, EDI-034, EDI-026.

**Interfaces:**
- `MediaField`: a video is uploaded with its framing only (`sendVideo` goes; a 4:3 video still sends `posterTime: Math.min(POSTER_SECONDS, duration)`, R-S28); "Recadrer" on a video opens the dialog over `value.source.url` (the edit copy) with `value.duration_seconds`; `reframable = Boolean(value?.source) && (value.kind === "image" || Boolean(value.duration_seconds))` — a legacy video has no source (T8), so the button is not offered; the busy state covers the whole upload (the server's processing included).
- `VideoCropDialog`: checking the box sets the poster time to the playhead; unchecked, the kept poster time is sent; the strip frames come from `captureFrames(video)` on the edit copy (CORS in S3 mode, MED-045).

- [ ] **Step 1: Write the failing tests**

```ts
test("MED-003 a video is uploaded without any image", …);                          // upload mock called with (slot, file, framing); FormData has no "poster"
test("MED-003 EDI-034 the poster box only sets the poster time", …);                 // onApply gets posterTime = playhead, no newPoster key
test("MED-030 EDI-034 a stored video is re-framed from its edit copy", …);           // dialog `video` prop = source.url (.mp4), not video_url; reframe called with (id, {crop, loop, posterTime})
test("MED-030 a video without a source offers no re-framing", …);                   // legacy video view → "Recadrer" absent, cannotRecrop hint shown
test("MED-021 a video the browser cannot read in time still gives the field back", …); // unchanged behaviour, re-asserted after the refactor
```

- [ ] **Step 2: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/components/editor src/lib/media` · Expected: FAIL.
- [ ] **Step 3: Implement**; remove dead code (`canvasToJpeg`, `capturePoster`, their tests).
- [ ] **Step 4: Run and see them pass** — same, then `pnpm -C frontend -r typecheck && pnpm -C frontend -r lint` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): let the server make the video placeholder and re-frame from the edit copy"`

---

### Task T13: Public page — the served video as is, a reliable video loader

Independent of the backend (fixtures only); before T14.

**Files:** Modify: `frontend/web/src/templates/HeaderMedia.tsx`, `frontend/web/src/templates/HeaderMedia.test.tsx`, `frontend/web/src/lib/media/framing.ts` (delete `loopRestart`; `videoCropStyle` stays, the crop dialogs use it), `frontend/web/src/lib/media/framing.test.ts`, `frontend/web/src/templates/contract.test.tsx` (assert `loop` true now), `frontend/web/src/templates/fixtures.ts` (a legacy video fixture with a crop)
Create: `frontend/web/src/templates/useMediaLoad.ts` (+ test) — the load state shared with T14

**Rules:** PUB-005, PUB-006, PUB-041, MED-032, MED-033, PUB-031, PUB-038.

**Interfaces:**
- `useMediaLoad(ref, kind: "image" | "video"): "loading" | "loaded" | "failed"` — listens to `load`/`error` (image) or `canplay`/`playing`/`error` (video, and `error` on its `<source>`-less element); **on mount** reads the element's current state: image `complete && naturalWidth > 0` → loaded, `complete && naturalWidth === 0` → failed; video `readyState >= HAVE_FUTURE_DATA (3)` → loaded, `error !== null` or `networkState === NETWORK_NO_SOURCE` → failed.
- `HeaderVideo`: `<video loop playsInline preload="auto" muted …>` with `el.muted = true` set on the DOM property too (PUB-005), no `style` crop, no `onTimeUpdate`/`onEnded` loop code, no seek on mount (starts at 0); `play()` on mount unless reduced motion (unchanged); loading = `useMediaLoad(...) === "loading"`; the blurred placeholder and the sheen only while loading and not reduced motion; failed → placeholder shown, not blurred, no sheen, `aria-busy="false"`; the pause button unchanged (PUB-031).

- [ ] **Step 1: Write the failing tests**

```ts
test("PUB-005 MED-032 the served video loops over its whole file from its start", …);   // loop true, currentTime 0, no inline width/left style even with a stored crop
test("MED-033 a video uploaded before plan 7 is shown centred and not cropped", …);    // legacy fixture with crop → no crop style, object-fit cover (CSS class)
test("PUB-006 the header is busy until the video can play", …);                          // existing, kept
test("PUB-006 a video that cannot load drops the loader and keeps a sharp placeholder", …); // fire "error" → aria-busy false, no .cc-shimmer, no .is-blur, placeholder img present
test("PUB-041 a video already playable at mount is not shown as loading", …);            // readyState mocked 4 before render → aria-busy false at first paint after effects
test("PUB-041 a video that failed before mount is not shown as loading", …);             // error set before render
test("PUB-006 PUB-038 under reduced motion the placeholder is sharp and no sheen moves", …);
```

- [ ] **Step 2: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/templates src/lib/media/framing` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass** — same, then typecheck and lint · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): play the served header video as is, with a loader that survives hydration"`

---

### Task T14: Public page — header image and profile photo loaders, no loader without JavaScript

Depends on T13.

**Files:** Modify: `frontend/web/src/templates/HeaderMedia.tsx` (image branch), `frontend/web/src/templates/classique/Classique.tsx` (avatar: a small client component `AvatarPhoto` beside `HeaderMedia`, Classique stays hook-free), `frontend/web/src/templates/classique/classique.css` (`.cc-avatar.is-loading`, `.cc-media.is-failed`), `frontend/web/src/components/public/CardStage.tsx` (a `<noscript><style>` that hides `.cc-shimmer` and `.is-blur`, rendered around every template), their tests, `frontend/web/src/templates/contract.test.tsx` (every template keeps the test ids)

**Rules:** PUB-039, PUB-040, PUB-041, PUB-042, PUB-038, PUB-007 (the ring stays).

**Interfaces:**
- Header image: `<div class="cc-media is-loading" aria-busy="true">` with the `<img>` and `<div class="cc-shimmer" aria-hidden>` while loading; loaded → `cc-media`, no shimmer, `aria-busy="false"`; failed → the `<img>` hidden (`visibility: hidden` so no broken-image icon), surface colour (`--c-surface`), no shimmer.
- Avatar: the `.cc-avatar` circle gets the same three states (surface colour + shimmer clipped by the circle; the 4-pixel ring unchanged).
- Without JavaScript: the server-rendered markup is the loading state; the `<noscript>` style removes the sheen and the blur so that the media shows as soon as it arrives (PUB-042).

- [ ] **Step 1: Write the failing tests**

```ts
test("PUB-039 the header image shows the surface and the sheen until it loads", …);  // aria-busy true + .cc-shimmer; fire load → neither
test("PUB-039 a header image that cannot load leaves the surface without sheen", …);   // fire error → no shimmer, aria-busy false, img hidden
test("PUB-040 the profile photo shows the sheen in its circle until it loads", …);
test("PUB-040 a profile photo that cannot load keeps the surface in its circle", …);
test("PUB-041 an image already loaded at mount is not shown as loading", …);          // complete=true, naturalWidth=10 before effects
test("PUB-042 the page carries a noscript style that removes the sheen and the blur", …); // render the page shell / template wrapper, assert <noscript> content
test("PUB-038 the loading sheen does not move under reduced motion", …);              // CSS rule present in classique.css under the media query (file read)
```

- [ ] **Step 2: Run and see them fail** — `pnpm -C frontend --filter web exec vitest run src/templates src/components/public` · Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass** — same, typecheck, lint · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): loaders for the header image and the profile photo"`

---

### Task T15: End-to-end stack on S3, existing media tests adapted, browser decision

Depends on T7, T8, T9, T12, T13.

**Files:** Modify: `compose.test.yml` (garage + garage-init with fixed values: S3 `127.0.0.1:13900`, web `127.0.0.1:13902`, admin not published; api `depends_on: garage-init: service_completed_successfully`; api env `MEDIA_STORAGE: s3`, `MEDIA_S3_ENDPOINT: http://garage:3900`, buckets, region `garage`, the dev key, `MEDIA_PUBLIC_BASE_URL: http://localhost:13902`; `APP_ORIGIN` for the init `http://localhost:13000`; remove `MEDIA_LOCAL_DIR`), `frontend/e2e/env.ts` (`MEDIA_URL = "http://localhost:13902"`), `frontend/e2e/fixtures.ts` (`uploadMedia(subject, cardId, slot, file, framing?)`, no poster), `frontend/e2e/tests/media.spec.ts`, `frontend/e2e/tests/public-page.spec.ts`, `frontend/e2e/playwright.config.ts` (only if R-S24 applies), `frontend/e2e/fixtures/README.md`

**Rules:** MED-002, MED-003, MED-017, MED-028, MED-032, PUB-005, PUB-006, PUB-031, EDI-034, MED-045.

- [ ] **Step 1: Browser decision (R-S24)** — with the stack up, in each project run `page.evaluate(() => document.createElement("video").canPlayType('video/mp4; codecs="avc1.640028"'))`. If the desktop project (Playwright's Chromium) answers `""`, set `{ name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } }` and record it (execution ruling); CI then installs `chrome` (T17). If WebKit (mobile) answers `""` on Linux CI, stop and report: the owner decides. Note the result in `fixtures/README.md` (which says today that Chromium does not decode H.264).
- [ ] **Step 2: Check `up --wait`** — `make e2e-down && make e2e ARGS="-g PUB-002"`: `docker compose up -d --build --wait` must accept the exited `garage-init`; if it does not, start the init with `docker compose -f compose.test.yml run --rm garage-init` in the `e2e` target (and CI) before `up --wait` of the rest, and record it.
- [ ] **Step 3: Adapt the tests** (they fail first against the S3 stack)

```ts
test("MED-003 PUB-005 header video with a server-made placeholder", …); // UI upload of header-2s.mp4 (VP9 input): poster attr .webp from MEDIA_URL; muted; loop true; playsinline
test("EDI-034 MED-028 MED-032 framing the header video", …);           // loop {0.5,1.8} stored; the public video's duration ≈ 1.3 s; « Recadrer » draws 8 strip frames from the edit copy (CORS); the reframe request has no poster part; new poster_time stored
test("MED-017 the bucket honours Range", …);                            // GET video_url (on MEDIA_URL) with bytes=0-99 → 206
test("MED-002 a 45 MB video passes the web proxy", …);                  // header-2s.mp4 + 45 MB `free` box through WEB_URL → 201
test("PUB-005 the header video loops over its file", …);                // whole loop: still playing after 2.5 s; button "Mettre la vidéo en pause"
test("PUB-031 the pause button pauses the header video", …);            // unchanged, no poster in the helper
test("PUB-005 reduced motion keeps the poster", …);                     // unchanged
```
  Delete "MED-032 the video starts at its loop start" and "MED-033 a video without a stored loop keeps playing past its end" (replaced above).
- [ ] **Step 4: Run** — `make e2e ARGS="-g 'MED-0|PUB-00|PUB-031|EDI-034'"` then the whole suite `make e2e` · Expected: PASS on both projects.
- [ ] **Step 5: Commit** — `git commit -m "test(e2e): run the stack on S3 and adapt the video tests"`

---

### Task T16: End-to-end — big photo, non-4:3 video and loaders through the UI

Depends on T14, T15.

**Files:** Create: `frontend/e2e/tests/media-pipeline.spec.ts`, `frontend/e2e/fixtures/photo-24mpx.jpg` (~5–6 MB, 6,000 × 4,000), `frontend/e2e/fixtures/header-1080p.mp4` (1,920 × 1,080, 4 s, H.264 — or VP9 if T15's decision requires it); Modify: `frontend/e2e/fixtures/README.md` (commands: e.g. `ffmpeg -f lavfi -i "testsrc2=s=6000x4000,noise=alls=12:allf=t" -frames:v 1 -q:v 3 photo-24mpx.jpg`, tune `-q:v`/noise until 5–6 MB; `ffmpeg -f lavfi -i testsrc2=s=1920x1080:r=30:d=4 -c:v libx264 -pix_fmt yuv420p -crf 30 header-1080p.mp4`)

**Rules:** MED-012, MED-015, MED-034, MED-035, MED-037, MED-043, PUB-006, PUB-039, PUB-040, PUB-041, PUB-042, EDI-026.

- [ ] **Step 1: Write the tests**

```ts
test("MED-012 MED-015 EDI-026 a 24-megapixel photo goes through the editor", …);  // header input ← photo-24mpx.jpg; crop dialog opens (3:2); apply; save; public header img srcset has w1440 4:3 from MEDIA_URL; test timeout 90 s
test("MED-034 MED-035 a 16:9 video is framed and served 1280 × 960", …);          // header-1080p.mp4 through the UI, dialog: drag the loop end to ~2 s; save; public <video>: videoWidth 1280, videoHeight 960, duration ≈ loop length; poster .webp
test("MED-043 the served files carry their type, cache and inline disposition", …); // GET video_url and an image url: the three headers
test("MED-037 the owner's edit copy is the whole video", …);                       // GET /api/cards/{id} as owner → header.source.url .mp4 on MEDIA_URL answers 200; the public card JSON has no source
test("PUB-006 PUB-039 PUB-040 loaders show while the media load and then go", …);  // page.route delays MEDIA_URL responses by 1 s: aria-busy true + .cc-shimmer on header and avatar, then gone
test("PUB-039 PUB-040 a media that fails to load leaves no loader", …);            // page.route aborts MEDIA_URL: no .cc-shimmer, aria-busy false
test("PUB-041 a cached media is not shown as loading after a reload", …);          // visit, reload: poll aria-busy false within 2 s on header and avatar
test("PUB-042 without JavaScript no sheen is shown", …);                            // javaScriptEnabled false: .cc-shimmer not visible
```

- [ ] **Step 2: Run** — `make e2e ARGS="-g 'MED-012|MED-034|MED-037|MED-043|PUB-039|PUB-04'"` · Expected: PASS on both projects.
- [ ] **Step 3: Commit** — `git commit -m "test(e2e): big photo, 16:9 video and loaders on the S3 stack"`

---

### Task T17: CI — the e2e job on the new stack, a check of the whole workflow

Depends on T10, T15.

**Files:** Modify: `.github/workflows/ci.yml`

**Rules:** none new (MED-041, MED-009 exercised).

- [ ] **Step 1:** `api` job (ffmpeg from T3, Garage from T10): align the way the init is started with what T15 step 2 found (`up` or `run --rm garage-init`).
- [ ] **Step 2:** `e2e` job: unchanged stack command (Garage is in `compose.test.yml`); Playwright install line becomes `install --with-deps chromium webkit chrome` if T15 chose Chrome (`chromium` can then go).
- [ ] **Step 3:** push the branch and watch the `api` job (the `e2e` job only runs on `main`; it is verified by `make e2e` locally, CLAUDE.md step 5) · Expected: green.
- [ ] **Step 4: Commit** — `git commit -m "ci: ffmpeg and Garage for the API tests"`

---

### Task T18: Documentation and skills

Depends on T9, T15, T17.

**Files:** Modify: `README.md` (prerequisites: ffmpeg; `make dev-db` starts Postgres and Garage), `CLAUDE.md` (repository map: `docker/garage/`, `.data/media/` only in local mode; `make dev-db` row: Garage and its ports `DEV_S3_PORT`/`DEV_S3_WEB_PORT`/`DEV_S3_ADMIN_PORT`; `make test` needs `make dev-db` and ffmpeg; `make e2e` stack includes Garage; the instance's media variables), `.claude/skills/dev-env/SKILL.md` (media section rewritten: S3 by default, Garage URLs, reset with `docker compose -f compose.dev.yml down -v`, `MEDIA_STORAGE=local` for a phone on the LAN, ffmpeg), `.claude/skills/run-tests/SKILL.md` (rows: video transcode `video_ffmpeg::`, S3 `media_s3::` needs `make dev-db`, loaders `-g 'PUB-039|PUB-040|PUB-041'`), `frontend/e2e/fixtures/README.md` (final state), `docs/superpowers/plans/2026-11-05-cartouche-plan-7-followups.md` (execution rulings so far)

**Rules:** none.

- [ ] **Step 1:** write; every command quoted in the docs is run once to check it.
- [ ] **Step 2: Commit** — `git commit -m "docs: S3 by default, Garage and ffmpeg in the development environment"`

---

### Task T19: Measure the dev profile on a large photo and a video

Depends on T1, T7, T9. Run last before the gate.

**Files:** Modify: `docs/superpowers/plans/2026-11-05-cartouche-plan-7-followups.md` (a "Measurements" section)

**Rules:** none (owner decision 5).

- [ ] **Step 1:** `make dev-db`, `make api`, `make web`, `make seed && make seed SCENARIO=cards`; get a token for `seed-alice` (`POST http://localhost:8080/api/test/token`, see the `dev-env` skill) and Alice's card id.
- [ ] **Step 2:** time three uploads through the web origin, three runs each, median kept: `curl -s -o /dev/null -w '%{time_total}\n' -H "authorization: Bearer $TOKEN" -F slot=header -F file=@frontend/e2e/fixtures/photo-24mpx.jpg http://localhost:3000/api/cards/$CARD/media`; the same with `backend/server/tests/fixtures/video/landscape-1080p60-audio-gps.mp4`; and with a 30 s 1080p phone-like clip generated locally (not committed). Then once more with the `[profile.dev.package."*"]` block commented out (a temporary edit, restored with `git checkout backend/Cargo.toml`; never `git stash`, the stash is shared between worktrees), to show the gain.
- [ ] **Step 3:** record the numbers (machine, build, median seconds) and whether the 30 s clip stays well under the 120 s deadline; if it does not, stop and report (the deadline or the preset must change).
- [ ] **Step 4: Commit** — `git commit -m "docs: dev-build timings of the media pipeline"`

---

### Task T20: Spec status, coverage and the final gate

Depends on every task.

**Files:** `spec/media.md`, `spec/public-page.md`, `spec/dashboard-editor.md` (status lines), the follow-ups file.

- [ ] **Step 1: Status lines** — `media.md`: `> Status: implemented (plans 2, 3, 6 and 7)`; `public-page.md`: `> Status: implemented (plans 2, 3, 6 and 7)`; `dashboard-editor.md`: `> Status: implemented (plans 2, 3, 4, 6 and 7)`.
- [ ] **Step 2: Coverage** — `node scripts/spec-lint.mjs --coverage` · Expected: none of MED-034 to MED-046, PUB-039 to PUB-042, EDI-037 listed.
- [ ] **Step 3: Full check** — `make lint test` (with `make dev-db` up and ffmpeg installed), then `make e2e` (one worktree at a time) · Expected: PASS on both projects.
- [ ] **Step 4: Commit** — `git commit -m "docs(spec): plan 7 media pipeline implemented"`; then `feature-reviewer` on the whole branch.

---

## Task order and dependencies

| Task | Needs | Can run beside |
|---|---|---|
| T1 | — | anything |
| T2 | — | T5, T13 |
| T3 | T2 | T5, T6, T13 |
| T4 | T3 | T5, T6, T13 |
| T5 | — | T2, T3, T4 |
| T6 | T2 | T3, T4, T5 |
| T7 | T2, T4, T5 | T9, T13 |
| T8 | T7 | T9, T13 |
| T9 | T5 | T7, T8 |
| T10 | T5, T7, T9 | T11 to T14 |
| T11 | T7 | T10 |
| T12 | T8, T11 | T13 (different files) |
| T13 | — (web only) | backend tasks |
| T14 | T13 | backend tasks |
| T15 | T7, T8, T9, T12, T13 | — |
| T16 | T14, T15 | — |
| T17 | T10, T15 | — |
| T18 | T9, T15, T17 | — |
| T19 | T1, T7, T9 | — (last before the gate) |
| T20 | every task | — |

Only one task at a time touches `HeaderMedia.tsx` or `Classique.tsx` (T13, T14), and only one runs `make e2e` (T15, T16, T20) on the machine.
