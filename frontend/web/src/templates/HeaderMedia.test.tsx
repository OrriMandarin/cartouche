import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TEMPLATE_TEST_IDS as IDS } from "./contract";
import { sampleLegacyVideoHeader, sampleVideoHeader } from "./fixtures";
import { HeaderMedia } from "./HeaderMedia";

const labels = { pause: "Mettre la vidéo en pause", play: "Lire la vidéo" };
const legacy = sampleLegacyVideoHeader;
const framed = sampleVideoHeader;

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;

beforeEach(() => {
  play = vi.fn();
  pause = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play as never);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLMediaElement.prototype, "error");
});

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

  test("PUB-005 MED-032 the served video loops over its whole file from its start", () => {
    render(<HeaderMedia media={legacy} labels={labels} reducedMotion={() => false} />);
    expect(video().muted).toBe(true);
    expect(video().loop).toBe(true);
    expect(video().currentTime).toBe(0);
    expect(video().style.left).toBe("");
    expect(video().style.width).toBe("");
    expect(play).toHaveBeenCalledTimes(1);
    expect(video().autoplay).toBe(false);
  });

  test("MED-033 a video uploaded before plan 7 is shown centred and not cropped", () => {
    render(<HeaderMedia media={legacy} labels={labels} reducedMotion={() => false} />);
    expect(video().getAttribute("style")).toBeNull();
    expect(video().closest(".cc-media")).not.toBeNull();
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

  test("PUB-006 a video that cannot load drops the loader and keeps a sharp placeholder", () => {
    const { container } = render(<HeaderMedia media={framed} labels={labels} reducedMotion={() => false} />);
    fireEvent(video(), new Event("error"));
    const media = container.firstElementChild as HTMLElement;
    expect(media).toHaveAttribute("aria-busy", "false");
    expect(container.querySelector(".cc-shimmer")).toBeNull();
    expect(container.querySelector(".is-blur")).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
  });

  test("PUB-041 a video already playable at mount is not shown as loading", () => {
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
    const { container } = render(<HeaderMedia media={framed} labels={labels} reducedMotion={() => false} />);
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "false");
    expect(container.querySelector(".cc-shimmer")).toBeNull();
  });

  test("PUB-041 a video that failed before mount is not shown as loading", () => {
    // jsdom does not define `error`: install it for this test only.
    Object.defineProperty(HTMLMediaElement.prototype, "error", { value: { code: 4 }, configurable: true });
    const { container } = render(<HeaderMedia media={framed} labels={labels} reducedMotion={() => false} />);
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "false");
    expect(container.querySelector(".cc-shimmer")).toBeNull();
    expect(container.querySelector(".is-blur")).toBeNull();
  });

  test("PUB-006 PUB-038 under reduced motion the placeholder is sharp and no sheen moves", () => {
    const { container } = render(<HeaderMedia media={framed} labels={labels} reducedMotion={() => true} />);
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector(".is-blur")).toBeNull();
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

  test("PUB-031 a refused autoplay leaves the button on play", async () => {
    play.mockRejectedValue(new Error("NotAllowedError"));
    render(<HeaderMedia media={framed} labels={labels} reducedMotion={() => false} />);
    expect(await screen.findByRole("button", { name: labels.play })).toBeInTheDocument();
  });
});
