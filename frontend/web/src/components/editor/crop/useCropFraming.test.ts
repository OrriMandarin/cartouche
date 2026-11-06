import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useCropFraming } from "./useCropFraming";

const URL_OF_VIDEO = "https://media.example.test/video.mp4";
/** What react-easy-crop reports before the media is loaded: it works from the 300 × 150 placeholder of the element, whose natural size is unknown. */
const PLACEHOLDER = { area: { x: 16.67, y: 0, width: 66.67, height: 100 }, pixels: { x: 0, y: 0, width: 0, height: 0 } };
/** What it reports once the media is loaded: the centred 4:3 area of a 1920 × 1080 video. */
const LOADED = { area: { x: 12.5, y: 0, width: 75, height: 100 }, pixels: { x: 240, y: 0, width: 1440, height: 1080 } };

describe("useCropFraming", () => {
  // spec: MED-026
  test("MED-026 an area measured before the media is loaded is not a crop to apply", () => {
    const { result } = renderHook(() => useCropFraming(URL_OF_VIDEO, null));

    act(() => result.current.onAreaChange(PLACEHOLDER.area, PLACEHOLDER.pixels));

    expect(result.current.crop).toBeNull();
  });

  // spec: MED-026
  test("MED-026 the area measured on the loaded media is the crop, and the placeholder one never replaces it", () => {
    const { result } = renderHook(() => useCropFraming(URL_OF_VIDEO, null));

    act(() => result.current.onAreaChange(PLACEHOLDER.area, PLACEHOLDER.pixels));
    act(() => result.current.onAreaChange(LOADED.area, LOADED.pixels));
    expect(result.current.crop).toEqual({ x: 0.125, y: 0, width: 0.75, height: 1 });

    act(() => result.current.onAreaChange(PLACEHOLDER.area, PLACEHOLDER.pixels));
    expect(result.current.crop).toEqual({ x: 0.125, y: 0, width: 0.75, height: 1 });
  });

  // spec: MED-030
  test("MED-030 the stored crop stays the one to apply until the loaded media reports its area", () => {
    const stored = { x: 0.2, y: 0, width: 0.75, height: 1 };
    const { result } = renderHook(() => useCropFraming(URL_OF_VIDEO, stored));

    act(() => result.current.onAreaChange(PLACEHOLDER.area, PLACEHOLDER.pixels));

    expect(result.current.crop).toEqual(stored);
  });
});
