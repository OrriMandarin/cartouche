# Video fixtures

Small clips for the real-ffmpeg tests (`tests/it/video_ffmpeg.rs`). Generated once with
ffmpeg 8.1.2 (`brew install ffmpeg`); the synthetic `testsrc` pattern keeps them small. Do not
regenerate them casually: the tests depend on their size, length, codec and metadata.

| File | Content |
|---|---|
| `landscape-1080p60-audio-gps.mp4` | 1920 × 1080, 60 fps, 4 s, H.264 + AAC, `location` tag |
| `portrait-rotated.mp4` | 1920 × 1080 coded, display matrix 90° (displayed 1080 × 1920), 30 fps, 3 s, H.264 |
| `small-640x360-24fps.mp4` | 640 × 360, 24 fps, 2 s, VP9 in MP4 |
| `no-video-stream.mp4` | AAC only, `isom` brand |
| `truncated.mp4` | the first 4 KB of the landscape clip |
| `mpeg4-320x180.mp4` | 320 × 180, 24 fps, 1 s, MPEG-4 part 2 (a codec the server refuses, MED-040) |
| `hevc-320x180.mp4` | 320 × 180, 24 fps, 1 s, HEVC (libx265), accepted by MED-040 |
| `av1-320x180.mp4` | 320 × 180, 24 fps, 1 s, AV1 (libsvtav1), accepted by MED-040; its software decoder is `libdav1d` or `libaom-av1`, which the codec whitelist must name |

```sh
F=ffmpeg

$F -y -f lavfi -i "testsrc=size=1920x1080:rate=60:duration=4" \
   -f lavfi -i "sine=frequency=440:duration=4:sample_rate=44100" \
   -c:v libx264 -preset veryfast -crf 40 -g 120 -pix_fmt yuv420p -c:a aac -b:a 16k \
   -metadata location=+48.8566+002.3522/ -movflags +faststart landscape-1080p60-audio-gps.mp4

$F -y -f lavfi -i "testsrc=size=1920x1080:rate=30:duration=3" \
   -c:v libx264 -preset veryfast -crf 40 -g 90 -pix_fmt yuv420p /tmp/p.mp4
$F -y -display_rotation 90 -i /tmp/p.mp4 -c copy portrait-rotated.mp4

$F -y -f lavfi -i "testsrc=size=640x360:rate=24:duration=2" \
   -c:v libvpx-vp9 -b:v 0 -crf 50 -deadline realtime -cpu-used 8 small-640x360-24fps.mp4

$F -y -f lavfi -i "sine=frequency=440:duration=2:sample_rate=44100" \
   -c:a aac -b:a 32k -brand isom no-video-stream.mp4

$F -y -f lavfi -i "testsrc=size=320x180:rate=24:duration=1" -c:v mpeg4 -q:v 20 mpeg4-320x180.mp4

$F -y -f lavfi -i "testsrc=size=320x180:rate=24:duration=1" \
   -c:v libx265 -preset ultrafast -crf 40 -tag:v hvc1 hevc-320x180.mp4

$F -y -f lavfi -i "testsrc=size=320x180:rate=24:duration=1" \
   -c:v libsvtav1 -crf 50 -preset 10 av1-320x180.mp4

head -c 4096 landscape-1080p60-audio-gps.mp4 > truncated.mp4
```
