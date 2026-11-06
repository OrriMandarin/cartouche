# Media fixtures

Small files for the media end-to-end tests (`tests/media.spec.ts`). They are committed; regenerate them
with ffmpeg only if one has to change.

The videos are VP9 in an MP4 container, which also checks the codec allow-list of the server (MED-040). The
server re-encodes them to H.264 for the public page. Measured on macOS (plan 7, T15): the Chromium bundled with
Playwright (156) and its WebKit both play that H.264 file (`canPlayType` answers "probably", `videoWidth` > 0), so the
desktop project keeps the bundled Chromium. Not measured on Linux CI (see T17).

```sh
# 2 s header video (accepted)
ffmpeg -f lavfi -i color=c=0x3366cc:s=640x360:d=2 -c:v libvpx-vp9 -an -f mp4 header-2s.mp4
# 31 s header video (above the 30 s limit, refused before upload)
ffmpeg -f lavfi -i color=c=0x3366cc:s=640x360:d=31 -c:v libvpx-vp9 -an -f mp4 header-31s.mp4
# 800 x 600 test pattern, the profile photo to crop
ffmpeg -f lavfi -i testsrc=s=800x600 -frames:v 1 avatar.jpg
```
