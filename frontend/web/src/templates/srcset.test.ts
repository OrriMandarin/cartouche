import { describe, expect, test } from "vitest";
import type { MediaView } from "./contract";
import { srcSet } from "./srcset";

describe("srcSet", () => {
  test("TPL-002 lists every image of the media with its width", () => {
    const media = {
      images: [
        { url: "/m/a-320.webp", width: 320 },
        { url: "/m/a-640.webp", width: 640 },
      ],
    } as MediaView;
    expect(srcSet(media)).toBe("/m/a-320.webp 320w, /m/a-640.webp 640w");
  });
});
