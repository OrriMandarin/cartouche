import { ApiError } from "@cartouche/api-client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { checkBeforeUpload, mediaErrorKey, uploadMedia } from "./upload";

const MB = 1024 * 1024;

/** A file of a given type and (declared) size, without allocating the bytes. */
function fileOf(type: string, size = 1024, name = "file"): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

const mediaView = {
  id: "0198a1a0-0000-7000-8000-000000000009",
  kind: "image",
  images: [{ width: 640, url: "/media/cards/c/m/w640.webp" }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkBeforeUpload", () => {
  test("MED-012 MED-002 client-side hints before upload", () => {
    expect(checkBeforeUpload(fileOf("image/gif"), "header")).toBe("unsupported");
    expect(checkBeforeUpload(fileOf("image/jpeg", 11 * MB), "header")).toBe("too_large");
    expect(checkBeforeUpload(fileOf("image/jpeg", 10 * MB), "header")).toBeNull();
    expect(checkBeforeUpload(fileOf("video/mp4", 26 * MB), "header")).toBe("too_large");
    expect(checkBeforeUpload(fileOf("video/mp4", 25 * MB), "header")).toBeNull();
    expect(checkBeforeUpload(fileOf("video/mp4"), "avatar")).toBe("unsupported");
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(checkBeforeUpload(fileOf(type), "avatar")).toBeNull();
    }
  });

  test("TPL-004 a template without video refuses one in the header", () => {
    expect(checkBeforeUpload(fileOf("video/mp4"), "header", ["image"])).toBe("unsupported");
    expect(checkBeforeUpload(fileOf("image/png"), "header", ["image"])).toBeNull();
  });
});

describe("uploadMedia", () => {
  test("MED-003 upload sends slot, file and poster", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(mediaView), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const video = new Blob(["video"], { type: "video/mp4" });
    const poster = new Blob(["poster"], { type: "image/jpeg" });

    const result = await uploadMedia(async () => "tok-1", "card-1", "header", video, poster);

    expect(result).toEqual(mediaView);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/cards/card-1/media");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok-1");
    const form = init.body as FormData;
    expect(form.get("slot")).toBe("header");
    expect((form.get("file") as File).size).toBe(5);
    expect((form.get("poster") as File).size).toBe(6);
  });

  test("MED-003 an image goes without poster and without a token when signed out", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(mediaView), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await uploadMedia(async () => null, "card-1", "avatar", new Blob(["img"], { type: "image/jpeg" }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    const form = init.body as FormData;
    expect(form.get("slot")).toBe("avatar");
    expect(form.has("poster")).toBe(false);
  });

  test("MED-013 server media errors are converted to ApiError, then to a message", async () => {
    const body = {
      error: {
        code: "validation_failed",
        message: "Invalid fields.",
        request_id: "req-9",
        fields: [{ field: "file", code: "video_too_long" }],
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 400 })));

    const failure = await uploadMedia(async () => "t", "card-1", "header", new Blob(["v"])).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).requestId).toBe("req-9");
    expect(mediaErrorKey(failure)).toBe("editor.media.errors.video_too_long");
  });
});

describe("mediaErrorKey", () => {
  const apiError = (status: number, code: string, fields: { field: string; code: string }[] = []) =>
    new ApiError({ status, code, message: "m", requestId: null, fields });

  test("MED-013 MED-012 every server code has its message", () => {
    expect(mediaErrorKey(apiError(400, "validation_failed", [{ field: "poster", code: "poster_required" }]))).toBe(
      "editor.media.errors.poster_required",
    );
    expect(mediaErrorKey(apiError(400, "validation_failed", [{ field: "file", code: "image_too_large" }]))).toBe(
      "editor.media.errors.image_too_large",
    );
    // An image too large as a waiting image is still a too large image.
    expect(mediaErrorKey(apiError(400, "validation_failed", [{ field: "poster", code: "image_too_large" }]))).toBe(
      "editor.media.errors.image_too_large",
    );
    expect(mediaErrorKey(apiError(413, "payload_too_large"))).toBe("editor.media.errors.payload_too_large");
    expect(mediaErrorKey(apiError(415, "unsupported_media_type"))).toBe("editor.media.errors.unsupported_media_type");
  });

  test("MED-013 anything else reads as a generic failure", () => {
    expect(mediaErrorKey(apiError(500, "internal_error"))).toBe("editor.media.errors.generic");
    expect(mediaErrorKey(apiError(400, "validation_failed", [{ field: "slot", code: "required" }]))).toBe(
      "editor.media.errors.generic",
    );
    expect(mediaErrorKey(new TypeError("network"))).toBe("editor.media.errors.generic");
  });
});
