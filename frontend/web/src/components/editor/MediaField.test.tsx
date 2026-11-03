import { ApiError } from "@cartouche/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { MediaView, TemplateDefinition } from "@/templates/contract";
import { MediaField } from "./MediaField";
import { renderWithIntl } from "./test-helpers";

const readVideoDuration = vi.fn();
const capturePoster = vi.fn();
vi.mock("@/lib/media/video", () => ({
  readVideoDuration: (file: File) => readVideoDuration(file),
  capturePoster: (file: File) => capturePoster(file),
}));

// The cropper itself needs a browser: a stand-in that confirms a fixed square.
vi.mock("./AvatarCropper", () => ({
  AvatarCropper: ({ onConfirm, onError }: { onConfirm: (square: Blob) => void; onError: () => void }) => (
    <>
      <button type="button" data-testid="avatar-crop-confirm" onClick={() => onConfirm(new Blob(["square"], { type: "image/jpeg" }))}>
        ok
      </button>
      <button type="button" data-testid="avatar-crop-fail" onClick={onError}>
        fail
      </button>
    </>
  ),
}));

const media = (id: string, kind: MediaView["kind"] = "image"): MediaView => ({
  id,
  kind,
  images: [{ width: 640, url: `https://media.example.test/${id}/w640.webp` }],
  ...(kind === "video" ? { video_url: `https://media.example.test/${id}/video.mp4` } : {}),
});

const ALL: TemplateDefinition<unknown>["media"] = { header: ["image", "video"], avatar: true };

function Harness({
  declared = ALL,
  upload,
  initial = { header: null, avatar: null },
}: {
  declared?: TemplateDefinition<unknown>["media"];
  upload: (...args: unknown[]) => Promise<MediaView>;
  initial?: { header: MediaView | null; avatar: MediaView | null };
}) {
  const [state, setState] = useState(initial);
  return (
    <>
      <MediaField
        media={declared}
        header={state.header}
        avatar={state.avatar}
        upload={upload}
        onChange={(slot, value) => setState((current) => ({ ...current, [slot]: value }))}
      />
      <output data-testid="state">{JSON.stringify({ header: state.header?.id ?? null, avatar: state.avatar?.id ?? null })}</output>
    </>
  );
}

const state = () => JSON.parse(screen.getByTestId("state").textContent!) as { header: string | null; avatar: string | null };
const pick = (testId: string, file: File) => fireEvent.change(screen.getByTestId(testId), { target: { files: [file] } });
const jpeg = () => new File(["jpeg"], "photo.jpg", { type: "image/jpeg" });
const mp4 = () => new File(["mp4"], "clip.mp4", { type: "video/mp4" });

beforeEach(() => {
  readVideoDuration.mockReset().mockResolvedValue(2);
  capturePoster.mockReset().mockResolvedValue(new Blob(["poster"], { type: "image/jpeg" }));
});

describe("MediaField", () => {
  test("MED-001 a new header replaces the previous one in the draft", async () => {
    const upload = vi.fn().mockResolvedValue(media("new-header"));
    renderWithIntl(<Harness upload={upload} initial={{ header: media("old-header"), avatar: null }} />);
    expect(state().header).toBe("old-header");

    pick("media-header-input", jpeg());

    await waitFor(() => expect(state().header).toBe("new-header"));
    expect(upload).toHaveBeenCalledWith("header", expect.any(File), undefined);
  });

  test("MED-003 a video is sent with the poster captured from it", async () => {
    const upload = vi.fn().mockResolvedValue(media("clip", "video"));
    renderWithIntl(<Harness upload={upload} />);

    pick("media-header-input", mp4());

    await waitFor(() => expect(state().header).toBe("clip"));
    expect(upload).toHaveBeenCalledWith("header", expect.any(File), expect.any(Blob));
  });

  test("MED-013 a video above 30 seconds is refused before any upload", async () => {
    readVideoDuration.mockResolvedValue(31);
    const upload = vi.fn();
    renderWithIntl(<Harness upload={upload} />);

    pick("media-header-input", mp4());

    expect(await screen.findByTestId("media-header-error")).toHaveTextContent("La vidéo dépasse 30 secondes");
    expect(upload).not.toHaveBeenCalled();
    expect(capturePoster).not.toHaveBeenCalled();
  });

  test("MED-012 a file of the wrong type or too heavy is refused before any upload", async () => {
    const upload = vi.fn();
    renderWithIntl(<Harness upload={upload} />);

    pick("media-header-input", new File(["gif"], "a.gif", { type: "image/gif" }));
    expect(await screen.findByTestId("media-header-error")).toHaveTextContent("Ce format n'est pas accepté");

    const heavy = jpeg();
    Object.defineProperty(heavy, "size", { value: 11 * 1024 * 1024 });
    pick("media-header-input", heavy);
    expect(await screen.findByTestId("media-header-error")).toHaveTextContent("Ce fichier est trop lourd");
    expect(upload).not.toHaveBeenCalled();
  });

  test("MED-013 a refusal of the server is shown and the draft keeps its media", async () => {
    const refusal = new ApiError({
      status: 400,
      code: "validation_failed",
      message: "Invalid fields.",
      requestId: "r1",
      fields: [{ field: "file", code: "video_too_long" }],
    });
    const upload = vi.fn().mockRejectedValue(refusal);
    renderWithIntl(<Harness upload={upload} initial={{ header: media("old-header"), avatar: null }} />);

    pick("media-header-input", mp4());

    expect(await screen.findByTestId("media-header-error")).toHaveTextContent("La vidéo dépasse 30 secondes");
    expect(state().header).toBe("old-header");
  });

  test("MED-005 the profile photo goes through the cropper, and the square is what is sent", async () => {
    const upload = vi.fn().mockResolvedValue(media("face"));
    renderWithIntl(<Harness upload={upload} />);

    pick("media-avatar-input", jpeg());
    expect(upload).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId("avatar-crop-confirm"));

    await waitFor(() => expect(state().avatar).toBe("face"));
    const [slot, sent] = upload.mock.calls[0] as [string, Blob];
    expect(slot).toBe("avatar");
    expect(await sent.text()).toBe("square");
  });

  test("MED-005 a photo the cropper cannot read is reported, nothing is sent", async () => {
    const upload = vi.fn();
    renderWithIntl(<Harness upload={upload} />);

    pick("media-avatar-input", jpeg());
    fireEvent.click(await screen.findByTestId("avatar-crop-fail"));

    expect(await screen.findByTestId("media-avatar-error")).toHaveTextContent("Ce fichier ne peut pas être lu par le navigateur");
    expect(screen.queryByTestId("avatar-crop-confirm")).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  test("MED-002 MED-013 the 30.1 s tolerance of the server is mirrored: 30.05 s goes, 30.2 s does not", async () => {
    const upload = vi.fn().mockResolvedValue(media("clip", "video"));
    renderWithIntl(<Harness upload={upload} />);

    readVideoDuration.mockResolvedValue(30.2);
    pick("media-header-input", mp4());
    expect(await screen.findByTestId("media-header-error")).toHaveTextContent("La vidéo dépasse 30 secondes");
    expect(upload).not.toHaveBeenCalled();

    readVideoDuration.mockResolvedValue(30.05);
    pick("media-header-input", mp4());
    await waitFor(() => expect(state().header).toBe("clip"));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  test("MED-001 « Retirer » empties the slot in the draft", () => {
    renderWithIntl(<Harness upload={vi.fn()} initial={{ header: media("h"), avatar: media("a") }} />);
    fireEvent.click(screen.getByTestId("media-header-remove"));
    expect(state()).toEqual({ header: null, avatar: "a" });
    expect(screen.queryByTestId("media-header-remove")).toBeNull();
  });

  test("TPL-004 only the media slots declared by the template are offered", () => {
    renderWithIntl(<Harness upload={vi.fn()} declared={{ header: ["image"], avatar: false }} />);
    expect(screen.getByTestId("media-header-input").getAttribute("accept")).not.toContain("video/mp4");
    expect(screen.queryByTestId("media-avatar")).toBeNull();
  });

  test("TPL-004 a template with no header offers the profile photo alone, images only", () => {
    renderWithIntl(<Harness upload={vi.fn()} declared={{ header: [], avatar: true }} />);
    expect(screen.queryByTestId("media-header")).toBeNull();
    expect(screen.getByTestId("media-avatar-input").getAttribute("accept")).toBe("image/jpeg,image/png,image/webp");
    expect(ALL.header).toContain("video");
  });
});
