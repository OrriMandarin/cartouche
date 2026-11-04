import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TEMPLATE_TEST_IDS as IDS } from "./contract";
import { sampleVideoHeader } from "./fixtures";
import { HeaderMedia } from "./HeaderMedia";

const labels = { pause: "Mettre la vidéo en pause", play: "Lire la vidéo" };
const framed = { ...sampleVideoHeader, loop: { start: 0.8, end: 8.3 }, crop: { x: 0.25, y: 0, width: 0.5, height: 1 } };

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;

beforeEach(() => {
  play = vi.fn();
  pause = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play as never);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause as never);
});
afterEach(() => vi.restoreAllMocks());

function video() {
  return screen.getByTestId(IDS.headerVideo) as HTMLVideoElement;
}

describe("HeaderMedia", () => {
  test("PUB-004 an image header is a responsive image", () => {
    render(<HeaderMedia media={{ ...sampleVideoHeader, kind: "image", video_url: null }} labels={labels} />);
    expect(screen.getByTestId(IDS.headerImage).tagName).toBe("IMG");
    expect(screen.queryByTestId("header-video-toggle")).toBeNull();
  });

  test("PUB-004 without media the header is the empty band", () => {
    render(<HeaderMedia media={null} labels={labels} />);
    expect(screen.getByTestId(IDS.headerEmpty)).toBeInTheDocument();
  });

  test("PUB-005 the video is muted on the element and starts at the loop start", () => {
    render(<HeaderMedia media={framed} labels={labels} reducedMotion={() => false} />);
    expect(video().muted).toBe(true);
    expect(video().currentTime).toBe(0.8);
    expect(play).toHaveBeenCalledTimes(1);
    expect(video().loop).toBe(false);
    expect(video().autoplay).toBe(false);
  });

  test("PUB-005 PUB-038 under reduced motion the video does not start", () => {
    render(<HeaderMedia media={framed} labels={labels} reducedMotion={() => true} />);
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByTestId("header-video-toggle")).toHaveAccessibleName(labels.play);
    expect(document.querySelector(".is-blur")).toBeNull();
  });

  test("PUB-006 the header is busy until the video can play", () => {
    const { container } = render(<HeaderMedia media={framed} labels={labels} reducedMotion={() => false} />);
    const media = container.firstElementChild as HTMLElement;
    expect(media).toHaveAttribute("aria-busy", "true");
    expect(media).toHaveClass("is-loading");
    expect(container.querySelector(".is-blur")).not.toBeNull();
    expect(container.querySelector(".cc-shimmer")).not.toBeNull();
    fireEvent(video(), new Event("canplay"));
    expect(media).toHaveAttribute("aria-busy", "false");
    expect(media).not.toHaveClass("is-loading");
    expect(container.querySelector(".cc-shimmer")).toBeNull();
  });

  test("PUB-031 the button pauses and resumes and changes its name", () => {
    render(<HeaderMedia media={framed} labels={labels} reducedMotion={() => false} />);
    const button = screen.getByTestId("header-video-toggle");
    expect(button).toHaveAccessibleName(labels.pause);
    fireEvent.click(button);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(button).toHaveAccessibleName(labels.play);
    fireEvent.click(button);
    expect(play).toHaveBeenCalledTimes(2);
    expect(button).toHaveAccessibleName(labels.pause);
  });

  test("MED-032 the video loops inside its stored loop", () => {
    render(<HeaderMedia media={framed} labels={labels} reducedMotion={() => false} />);
    Object.defineProperty(video(), "duration", { value: 10, configurable: true });
    video().currentTime = 8.3;
    act(() => {
      fireEvent.timeUpdate(video());
    });
    expect(video().currentTime).toBe(0.8);
  });

  test("MED-033 PUB-031 at the end of the file the video restarts and still reads as playing", () => {
    render(<HeaderMedia media={{ ...sampleVideoHeader, loop: null }} labels={labels} reducedMotion={() => false} />);
    video().currentTime = 5;
    play.mockClear();
    fireEvent.pause(video());
    fireEvent.ended(video());
    expect(video().currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("header-video-toggle")).toHaveAccessibleName(labels.pause);
  });

  test("MED-032 at the end of the file the video restarts at its loop start", () => {
    render(<HeaderMedia media={framed} labels={labels} reducedMotion={() => false} />);
    fireEvent.ended(video());
    expect(video().currentTime).toBe(0.8);
  });

  test("PUB-031 a refused autoplay leaves the button on play", async () => {
    play.mockRejectedValue(new Error("NotAllowedError"));
    render(<HeaderMedia media={framed} labels={labels} reducedMotion={() => false} />);
    expect(await screen.findByRole("button", { name: labels.play })).toBeInTheDocument();
  });
});
