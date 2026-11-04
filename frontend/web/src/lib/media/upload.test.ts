import { ApiError } from "@cartouche/api-client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { checkBeforeUpload, mediaErrorKey, reframeMedia, uploadMedia } from "./upload";

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

  test("MED-028 MED-026 uploadMedia sends the framing fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(mediaView), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const video = new Blob(["video"], { type: "video/mp4" });
    const poster = new Blob(["poster"], { type: "image/jpeg" });

    await uploadMedia(async () => "t", "card-1", "header", video, poster, {
      crop: { x: 0.125, y: 0, width: 0.75, height: 1 },
      loop: { start: 0.5, end: 7.5 },
      posterTime: 0.1,
    });

    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(JSON.parse(form.get("crop") as string)).toEqual({ x: 0.125, y: 0, width: 0.75, height: 1 });
    expect(JSON.parse(form.get("loop") as string)).toEqual({ start: 0.5, end: 7.5 });
    expect(form.get("poster_time")).toBe("0.1");
  });

  test("MED-026 without framing, no framing field is sent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(mediaView), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await uploadMedia(async () => "t", "card-1", "header", new Blob(["img"], { type: "image/png" }), undefined, { posterTime: 0 });

    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(form.has("crop")).toBe(false);
    expect(form.has("loop")).toBe(false);
    expect(form.get("poster_time")).toBe("0");
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

describe("reframeMedia", () => {
  const crop = { x: 0.125, y: 0, width: 0.75, height: 1 };

  test("MED-030 sends the framing and the new frame to the reframe route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(mediaView), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const poster = new Blob(["poster"], { type: "image/jpeg" });

    const result = await reframeMedia(
      async () => "tok-1",
      "card-1",
      "media-1",
      { crop, loop: { start: 0.5, end: 7.5 }, posterTime: 1.5 },
      poster,
    );

    expect(result).toEqual(mediaView);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/cards/card-1/media/media-1/reframe");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok-1");
    const form = init.body as FormData;
    expect(JSON.parse(form.get("crop") as string)).toEqual(crop);
    expect(JSON.parse(form.get("loop") as string)).toEqual({ start: 0.5, end: 7.5 });
    expect(form.get("poster_time")).toBe("1.5");
    expect((form.get("poster") as File).size).toBe(6);
    expect(form.has("slot")).toBe(false);
    expect(form.has("file")).toBe(false);
  });

  test("MED-030 an image is re-framed with its crop alone", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(mediaView), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await reframeMedia(async () => null, "card-1", "media-1", { crop });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    const form = init.body as FormData;
    expect([...form.keys()]).toEqual(["crop"]);
  });

  test("MED-030 a media without source is refused as an ApiError", async () => {
    const body = { error: { code: "media_not_reframable", message: "m", request_id: "req-3" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 409 })));

    const failure = await reframeMedia(async () => "t", "card-1", "media-1", { crop }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("media_not_reframable");
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

  test("MED-030 MED-033 a media without source and a refused crop have their message", () => {
    expect(mediaErrorKey(apiError(409, "media_not_reframable"))).toBe("editor.media.errors.media_not_reframable");
    expect(mediaErrorKey(apiError(400, "validation_failed", [{ field: "crop", code: "invalid_crop" }]))).toBe(
      "editor.media.errors.invalid_crop",
    );
  });

  test("MED-013 anything else reads as a generic failure", () => {
    expect(mediaErrorKey(apiError(500, "internal_error"))).toBe("editor.media.errors.generic");
    expect(mediaErrorKey(apiError(400, "validation_failed", [{ field: "slot", code: "required" }]))).toBe(
      "editor.media.errors.generic",
    );
    expect(mediaErrorKey(new TypeError("network"))).toBe("editor.media.errors.generic");
  });
});
