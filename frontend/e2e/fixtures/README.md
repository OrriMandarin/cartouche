# Media fixtures

Small files for the media end-to-end tests (`tests/media.spec.ts`). They are committed; regenerate them
with ffmpeg only if one has to change.

The videos are VP9 in an MP4 container, which also checks the codec allow-list of the server (MED-040). The
server re-encodes them to H.264 for the public page. Measured on macOS (plan 7, T15) and in the official
`mcr.microsoft.com/playwright:v1.64.1-noble` image (T17, on arm64 and on linux/amd64, the CI
runners' architecture): the Chromium bundled with Playwright and its WebKit both play that H.264 file (`canPlayType` answers "probably",
`videoWidth` > 0, `readyState` 4), so the desktop project keeps the bundled Chromium and CI installs `chromium webkit`.

```sh
# 2 s header video (accepted)
ffmpeg -f lavfi -i color=c=0x3366cc:s=640x360:d=2 -c:v libvpx-vp9 -an -f mp4 header-2s.mp4
# 31 s header video (above the 30 s limit, refused before upload)
ffmpeg -f lavfi -i color=c=0x3366cc:s=640x360:d=31 -c:v libvpx-vp9 -an -f mp4 header-31s.mp4
# 800 x 600 test pattern, the profile photo to crop
ffmpeg -f lavfi -i testsrc=s=800x600 -frames:v 1 avatar.jpg
```

Fixtures of `tests/media-pipeline.spec.ts` (plan 7, T16):

```sh
# 24-megapixel photo (6,000 x 4,000, about 5.9 MB, below the 10 MB and 40 megapixel limits of MED-012): noise on a
# gradient so that the JPEG is as heavy as a phone photo; tune -q:v if it has to change
ffmpeg -f lavfi -i "gradients=s=400x266:seed=7,noise=alls=60:allf=u,scale=6000:4000:flags=bicubic" -frames:v 1 -q:v 5 photo-24mpx.jpg
# 16:9 header video (1,920 x 1,080, 4 s, H.264) with an audio track, which the server must drop (MED-038)
ffmpeg -f lavfi -i testsrc=s=1920x1080:r=15:d=4 -f lavfi -i sine=frequency=440:duration=4 -c:v libx264 -pix_fmt yuv420p -crf 35 -c:a aac -b:a 32k -shortest -movflags +faststart header-1080p.mp4
```
