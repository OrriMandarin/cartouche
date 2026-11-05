import { act, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, test } from "vitest";
import { useMediaLoad } from "./useMediaLoad";

function Probe({ kind, setup }: { kind: "image" | "video"; setup?: (el: HTMLElement) => void }) {
  const ref = useRef<HTMLImageElement & HTMLVideoElement>(null);
  const state = useMediaLoad(ref, kind);
  return kind === "image" ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={(el) => { if (el && setup) setup(el); (ref as { current: unknown }).current = el; }} alt="" data-state={state} />
  ) : (
    <video src="https://media.example.test/v.mp4" ref={(el) => { if (el && setup) setup(el); (ref as { current: unknown }).current = el; }} data-state={state} />
  );
}

function define(el: HTMLElement, props: Record<string, unknown>) {
  for (const [key, value] of Object.entries(props)) Object.defineProperty(el, key, { value, configurable: true });
}

function stateOf(container: HTMLElement, tag: string) {
  return container.querySelector(tag)!.getAttribute("data-state");
}

describe("useMediaLoad", () => {
  test("PUB-041 an image is loading until its load event", () => {
    const { container } = render(<Probe kind="image" setup={(el) => define(el, { complete: false, naturalWidth: 0 })} />);
    expect(stateOf(container, "img")).toBe("loading");
    act(() => {
      fireEvent.load(container.querySelector("img")!);
    });
    expect(stateOf(container, "img")).toBe("loaded");
  });

  test("PUB-041 an image that errors is failed", () => {
    const { container } = render(<Probe kind="image" setup={(el) => define(el, { complete: false, naturalWidth: 0 })} />);
    act(() => {
      fireEvent.error(container.querySelector("img")!);
    });
    expect(stateOf(container, "img")).toBe("failed");
  });

  test("PUB-041 an image already loaded at mount is loaded", () => {
    const { container } = render(<Probe kind="image" setup={(el) => define(el, { complete: true, naturalWidth: 640 })} />);
    expect(stateOf(container, "img")).toBe("loaded");
  });

  test("PUB-041 an image that failed before mount is failed", () => {
    const { container } = render(<Probe kind="image" setup={(el) => define(el, { complete: true, naturalWidth: 0 })} />);
    expect(stateOf(container, "img")).toBe("failed");
  });

  test("PUB-041 a video is loading until it can play, and failed on error", () => {
    const { container } = render(<Probe kind="video" />);
    expect(stateOf(container, "video")).toBe("loading");
    act(() => {
      fireEvent(container.querySelector("video")!, new Event("canplay"));
    });
    expect(stateOf(container, "video")).toBe("loaded");

    const second = render(<Probe kind="video" />);
    act(() => {
      fireEvent(second.container.querySelector("video")!, new Event("error"));
    });
    expect(stateOf(second.container, "video")).toBe("failed");
  });

  test("PUB-041 a video playable at mount is loaded", () => {
    const { container } = render(<Probe kind="video" setup={(el) => define(el, { readyState: 4 })} />);
    expect(stateOf(container, "video")).toBe("loaded");
  });

  test("PUB-041 a video that failed before mount is failed", () => {
    const withError = render(<Probe kind="video" setup={(el) => define(el, { error: { code: 4 } })} />);
    expect(stateOf(withError.container, "video")).toBe("failed");
    const noSource = render(<Probe kind="video" setup={(el) => define(el, { networkState: 3 })} />);
    expect(stateOf(noSource.container, "video")).toBe("failed");
  });
});
