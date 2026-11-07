//! The ffmpeg adapter on real files: probe, transcode, edit copy and poster frame
//! (MED-003, MED-026, MED-034, MED-035, MED-037, MED-038, MED-039). These tests are never
//! skipped: they need `ffmpeg` and `ffprobe` (`FFMPEG_PATH`, `FFPROBE_PATH`, or the PATH).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use cartouche_api::media::transcode::{TranscodeError, TranscodeRequest, transcode};
use cartouche_api::media::video::{
    Ffmpeg, RenderJob, RenderOutputs, VideoError, VideoProcessor, VideoService,
};
use cartouche_domain::{CropRect, PosterSeek, VideoLoop, VideoPlan, plan_video};
use serde_json::Value;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/video")
        .join(name)
}

fn program(variable: &str, default: &str) -> PathBuf {
    std::env::var_os(variable).map_or_else(|| PathBuf::from(default), PathBuf::from)
}

fn adapter() -> Ffmpeg {
    let ffmpeg = program("FFMPEG_PATH", "ffmpeg");
    let ffprobe = program("FFPROBE_PATH", "ffprobe");
    for tool in [&ffmpeg, &ffprobe] {
        assert!(
            Command::new(tool).arg("-version").output().is_ok(),
            "install ffmpeg (brew install ffmpeg / apt-get install ffmpeg): {} not found",
            tool.display()
        );
    }
    Ffmpeg::new(ffmpeg, ffprobe)
}

/// `ffprobe -show_streams -show_format` of a produced file.
fn inspect(path: &Path) -> Value {
    let output = Command::new(program("FFPROBE_PATH", "ffprobe"))
        .args([
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
        ])
        .arg(path)
        .output()
        .expect("ffprobe runs");
    assert!(output.status.success(), "ffprobe: {output:?}");
    serde_json::from_slice(&output.stdout).expect("ffprobe prints JSON")
}

/// The names of the top-level boxes of an MP4 file, in order.
fn top_level_boxes(path: &Path) -> Vec<String> {
    let bytes = std::fs::read(path).expect("file exists");
    let mut boxes = Vec::new();
    let mut at = 0;
    while at + 8 <= bytes.len() {
        let size = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        boxes.push(String::from_utf8_lossy(&bytes[at + 4..at + 8]).into_owned());
        if size < 8 {
            break;
        }
        at += size;
    }
    boxes
}

fn number(value: &Value) -> f64 {
    value
        .as_str()
        .expect("a string")
        .parse()
        .expect("a number in a string")
}

fn frame_rate(stream: &Value) -> f64 {
    let rate = stream["avg_frame_rate"].as_str().unwrap();
    let (numerator, denominator) = rate.split_once('/').unwrap();
    numerator.parse::<f64>().unwrap() / denominator.parse::<f64>().unwrap()
}

struct Rendered {
    outputs: RenderOutputs,
    _dir: tempfile::TempDir,
}

/// Probes `name`, plans it with the given crop and loop, and renders it with an edit copy.
async fn render(
    name: &str,
    crop: Option<CropRect>,
    video_loop: Option<VideoLoop>,
    poster_time: f64,
) -> Rendered {
    let ffmpeg = adapter();
    let input = fixture(name);
    let probe = ffmpeg.probe(&input).await.expect("probe");
    let duration = number(&inspect(&input)["format"]["duration"]);
    let video_loop = video_loop.unwrap_or(VideoLoop {
        start: 0.0,
        end: duration,
    });
    let (plan, _) = plan_video(
        &probe,
        Duration::from_secs_f64(duration),
        crop,
        video_loop,
        poster_time,
    )
    .expect("plan");
    render_plan(&ffmpeg, &input, plan).await
}

async fn render_plan(ffmpeg: &Ffmpeg, input: &Path, plan: VideoPlan) -> Rendered {
    let dir = tempfile::tempdir().unwrap();
    let job = RenderJob {
        input: input.to_path_buf(),
        out_dir: dir.path().to_path_buf(),
        plan,
        edit_copy: true,
    };
    let outputs = ffmpeg.render(&job).await.expect("render");
    Rendered { outputs, _dir: dir }
}

fn single_stream(path: &Path) -> Value {
    let report = inspect(path);
    let streams = report["streams"].as_array().unwrap();
    assert_eq!(streams.len(), 1, "one stream only: {streams:?}");
    streams[0].clone()
}

// spec: MED-039
#[tokio::test]
async fn probe_reports_the_displayed_size_and_codec() {
    let ffmpeg = adapter();
    let landscape = ffmpeg
        .probe(&fixture("landscape-1080p60-audio-gps.mp4"))
        .await
        .unwrap();
    assert_eq!(
        (landscape.width, landscape.height, landscape.codec.as_str()),
        (1920, 1080, "h264")
    );
    let rotated = ffmpeg
        .probe(&fixture("portrait-rotated.mp4"))
        .await
        .unwrap();
    assert_eq!((rotated.width, rotated.height), (1080, 1920));
    let small = ffmpeg
        .probe(&fixture("small-640x360-24fps.mp4"))
        .await
        .unwrap();
    assert_eq!(small.codec, "vp9");
}

// spec: MED-039
#[tokio::test]
async fn an_unreadable_file_is_reported_unreadable() {
    let ffmpeg = adapter();
    for name in ["truncated.mp4", "no-video-stream.mp4"] {
        let result = ffmpeg.probe(&fixture(name)).await;
        assert!(
            matches!(result, Err(VideoError::Unreadable(_))),
            "{name}: {result:?}"
        );
    }
}

// spec: MED-039
#[tokio::test]
async fn a_missing_program_is_a_tool_error() {
    let ffmpeg = Ffmpeg::new("/nonexistent/ffmpeg", "/nonexistent/ffprobe");
    let result = ffmpeg
        .probe(&fixture("landscape-1080p60-audio-gps.mp4"))
        .await;
    assert!(matches!(result, Err(VideoError::Tool(_))), "{result:?}");
}

// spec: MED-034, MED-035
#[tokio::test]
async fn the_served_file_is_the_cropped_loop_in_h264() {
    let crop = CropRect {
        x: 0.125,
        y: 0.0,
        width: 0.75,
        height: 1.0,
    };
    let rendered = render(
        "landscape-1080p60-audio-gps.mp4",
        Some(crop),
        Some(VideoLoop {
            start: 1.0,
            end: 3.0,
        }),
        0.0,
    )
    .await;
    let served = &rendered.outputs.served;
    let stream = single_stream(served);
    assert_eq!(stream["codec_name"], "h264");
    assert_eq!(stream["profile"], "High");
    assert_eq!(stream["pix_fmt"], "yuv420p");
    assert_eq!(
        (stream["width"].as_u64(), stream["height"].as_u64()),
        (Some(1280), Some(960))
    );
    assert!(frame_rate(&stream) <= 30.01, "{}", frame_rate(&stream));
    let duration = number(&inspect(served)["format"]["duration"]);
    assert!((duration - 2.0).abs() <= 0.1, "duration {duration}");
    let boxes = top_level_boxes(served);
    let position = |name: &str| boxes.iter().position(|b| b == name).unwrap();
    assert!(position("moov") < position("mdat"), "{boxes:?}");
}

// spec: MED-038
#[tokio::test]
async fn the_served_file_and_edit_copy_have_no_sound_nor_metadata() {
    let rendered = render("landscape-1080p60-audio-gps.mp4", None, None, 0.0).await;
    let edit_copy = rendered.outputs.edit_copy.as_ref().expect("an edit copy");
    for path in [&rendered.outputs.served, edit_copy] {
        let stream = single_stream(path);
        assert_eq!(stream["codec_type"], "video");
        let report = inspect(path);
        let tags = report["format"]["tags"].to_string().to_lowercase();
        assert!(!tags.contains("location"), "{tags}");
        assert!(!tags.contains("48.8566"), "{tags}");
        let bytes = std::fs::read(path).unwrap();
        assert!(!bytes.windows(7).any(|w| w == b"48.8566"));
    }
}

// spec: MED-037
#[tokio::test]
async fn the_edit_copy_is_the_whole_video_at_960() {
    let rendered = render("landscape-1080p60-audio-gps.mp4", None, None, 0.0).await;
    let edit_copy = rendered.outputs.edit_copy.as_ref().expect("an edit copy");
    let stream = single_stream(edit_copy);
    assert_eq!(
        (stream["width"].as_u64(), stream["height"].as_u64()),
        (Some(960), Some(540))
    );
    assert_eq!(stream["codec_name"], "h264");
    let duration = number(&inspect(edit_copy)["format"]["duration"]);
    assert!((duration - 4.0).abs() <= 0.1, "duration {duration}");
    let boxes = top_level_boxes(edit_copy);
    let position = |name: &str| boxes.iter().position(|b| b == name).unwrap();
    assert!(position("moov") < position("mdat"), "{boxes:?}");
}

// spec: MED-035, MED-037
#[tokio::test]
async fn a_small_video_is_never_enlarged() {
    let rendered = render("small-640x360-24fps.mp4", None, None, 0.0).await;
    let served = single_stream(&rendered.outputs.served);
    assert_eq!(
        (served["width"].as_u64(), served["height"].as_u64()),
        (Some(480), Some(360))
    );
    assert!(
        (frame_rate(&served) - 24.0).abs() < 0.5,
        "{}",
        frame_rate(&served)
    );
    let edit_copy = single_stream(rendered.outputs.edit_copy.as_ref().unwrap());
    assert_eq!(
        (edit_copy["width"].as_u64(), edit_copy["height"].as_u64()),
        (Some(640), Some(360))
    );
}

// spec: MED-026
#[tokio::test]
async fn a_rotated_video_comes_out_upright() {
    // 4:3 on the displayed 1080 × 1920 frame.
    let crop = CropRect {
        x: 0.0,
        y: 0.25,
        width: 1.0,
        height: 0.421875,
    };
    let rendered = render("portrait-rotated.mp4", Some(crop), None, 0.0).await;
    for (path, size) in [
        (&rendered.outputs.served, (1080, 810)),
        (rendered.outputs.edit_copy.as_ref().unwrap(), (540, 960)),
    ] {
        let stream = single_stream(path);
        assert_eq!(
            (stream["width"].as_u64(), stream["height"].as_u64()),
            (Some(size.0), Some(size.1))
        );
        assert!(
            !stream.to_string().contains("rotation"),
            "no rotation left: {stream}"
        );
    }
}

/// Plans and renders `name` with the whole video and the default crop, returning the plan too.
async fn render_with_plan(name: &str, poster_time: f64, edit_copy: bool) -> (VideoPlan, Rendered) {
    let ffmpeg = adapter();
    let input = fixture(name);
    let probe = ffmpeg.probe(&input).await.expect("probe");
    let duration = number(&inspect(&input)["format"]["duration"]);
    let (plan, _) = plan_video(
        &probe,
        Duration::from_secs_f64(duration),
        None,
        VideoLoop {
            start: 0.0,
            end: duration,
        },
        poster_time,
    )
    .expect("plan");
    let dir = tempfile::tempdir().unwrap();
    let job = RenderJob {
        input,
        out_dir: dir.path().to_path_buf(),
        plan: plan.clone(),
        edit_copy,
    };
    let outputs = ffmpeg.render(&job).await.expect("render");
    (plan, Rendered { outputs, _dir: dir })
}

fn pixels(path: &Path) -> (u32, u32, Vec<u8>) {
    let image = image::open(path).expect("a PNG").to_rgb8();
    (image.width(), image.height(), image.into_raw())
}

// spec: MED-003
#[tokio::test]
async fn the_poster_frame_is_the_full_frame_at_the_poster_time() {
    let name = "landscape-1080p60-audio-gps.mp4";
    let (_, first) = render_with_plan(name, 0.0, false).await;
    let (_, middle) = render_with_plan(name, 1.0, false).await;
    let (_, late) = render_with_plan(name, 3.0, false).await;
    let (plan, last) = render_with_plan(name, 4.0, false).await;
    assert_eq!(plan.poster, PosterSeek::LastFrame);
    let first = pixels(&first.outputs.poster_frame);
    let middle = pixels(&middle.outputs.poster_frame);
    let late = pixels(&late.outputs.poster_frame);
    let last = pixels(&last.outputs.poster_frame);
    for frame in [&first, &middle, &late, &last] {
        assert_eq!((frame.0, frame.1), (1920, 1080));
    }
    assert_ne!(middle.2, first.2, "1.0 s differs from 0 s");
    assert_ne!(middle.2, late.2, "1.0 s differs from 3.0 s");
    assert_ne!(last.2, first.2, "the last frame differs from the first");
}

// spec: MED-003, MED-026
#[tokio::test]
async fn the_poster_of_a_rotated_video_is_upright() {
    let (_, rendered) = render_with_plan("portrait-rotated.mp4", 1.0, false).await;
    let frame = pixels(&rendered.outputs.poster_frame);
    assert_eq!((frame.0, frame.1), (1080, 1920));
}

// spec: MED-037
#[tokio::test]
async fn without_an_edit_copy_only_the_served_file_and_poster_are_written() {
    let (_, rendered) = render_with_plan("landscape-1080p60-audio-gps.mp4", 0.5, false).await;
    assert!(rendered.outputs.edit_copy.is_none());
    assert!(rendered.outputs.served.metadata().unwrap().len() > 0);
    assert!(rendered.outputs.poster_frame.metadata().unwrap().len() > 0);
    let dir = rendered.outputs.served.parent().unwrap();
    assert!(!dir.join("edit-copy.mp4").exists());
    let stream = single_stream(&rendered.outputs.served);
    assert_eq!(
        (stream["width"].as_u64(), stream["height"].as_u64()),
        (Some(1280), Some(960))
    );
}

// spec: MED-039
#[tokio::test]
async fn rendering_an_unreadable_file_fails_unreadable() {
    let ffmpeg = adapter();
    let landscape = ffmpeg
        .probe(&fixture("landscape-1080p60-audio-gps.mp4"))
        .await
        .unwrap();
    let (plan, _) = plan_video(
        &landscape,
        Duration::from_secs(4),
        None,
        VideoLoop {
            start: 0.0,
            end: 4.0,
        },
        0.0,
    )
    .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let job = RenderJob {
        input: fixture("truncated.mp4"),
        out_dir: dir.path().to_path_buf(),
        plan,
        edit_copy: true,
    };
    let result = ffmpeg.render(&job).await;
    assert!(
        matches!(result, Err(VideoError::Unreadable(_))),
        "{result:?}"
    );
}

// spec: MED-003, MED-039
#[tokio::test]
async fn a_poster_past_the_end_that_writes_no_frame_is_unreadable() {
    let ffmpeg = adapter();
    let probe = ffmpeg
        .probe(&fixture("landscape-1080p60-audio-gps.mp4"))
        .await
        .unwrap();
    let (mut plan, _) = plan_video(
        &probe,
        Duration::from_secs(4),
        None,
        VideoLoop {
            start: 0.0,
            end: 4.0,
        },
        0.0,
    )
    .unwrap();
    plan.poster = PosterSeek::At(60.0);
    let dir = tempfile::tempdir().unwrap();
    let job = RenderJob {
        input: fixture("landscape-1080p60-audio-gps.mp4"),
        out_dir: dir.path().to_path_buf(),
        plan,
        edit_copy: false,
    };
    let result = ffmpeg.render(&job).await;
    assert!(
        matches!(result, Err(VideoError::Unreadable(_))),
        "{result:?}"
    );
}

// spec: MED-040
#[tokio::test]
async fn a_video_in_another_codec_is_refused_unsupported() {
    let service = VideoService::new(Arc::new(adapter()), 1, Duration::from_secs(60));
    let bytes = std::fs::read(fixture("mpeg4-320x180.mp4")).unwrap();
    let request = TranscodeRequest {
        duration: Duration::from_secs(1),
        crop: None,
        video_loop: VideoLoop {
            start: 0.0,
            end: 1.0,
        },
        poster_time: 0.0,
        edit_copy: true,
    };
    let result = transcode(&service, Bytes::from(bytes), request).await;
    assert!(
        matches!(result, Err(TranscodeError::UnsupportedCodec)),
        "{result:?}"
    );
}

// spec: MED-040
#[tokio::test]
async fn a_sound_track_does_not_stop_the_probe_nor_the_render() {
    // The landscape clip carries AAC, which the tool never decodes.
    let rendered = render("landscape-1080p60-audio-gps.mp4", None, None, 0.0).await;
    assert!(rendered.outputs.served.exists());
}

// spec: MED-040
#[tokio::test]
async fn an_hevc_video_is_probed_and_transcoded() {
    assert_accepted_codec("hevc-320x180.mp4", "hevc").await;
}

// spec: MED-040
#[tokio::test]
async fn an_av1_video_is_probed_and_transcoded() {
    assert_accepted_codec("av1-320x180.mp4", "av1").await;
}

/// The fixture is probed under its codec name and transcoded to the served H.264 file.
async fn assert_accepted_codec(name: &str, codec: &str) {
    let probe = adapter().probe(&fixture(name)).await.unwrap();
    assert_eq!(
        (probe.width, probe.height, probe.codec.as_str()),
        (320, 180, codec)
    );
    let service = VideoService::new(Arc::new(adapter()), 1, Duration::from_secs(60));
    let request = TranscodeRequest {
        duration: Duration::from_secs(1),
        crop: None,
        video_loop: VideoLoop {
            start: 0.0,
            end: 1.0,
        },
        poster_time: 0.0,
        edit_copy: true,
    };
    let bytes = Bytes::from(std::fs::read(fixture(name)).unwrap());
    let transcoded = transcode(&service, bytes, request).await;
    assert!(transcoded.is_ok(), "{:?}", transcoded.err());
}
