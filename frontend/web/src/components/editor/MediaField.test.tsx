import { ApiError } from "@cartouche/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { CropRect } from "@/lib/media/upload";
import { resolveTheme } from "@/lib/theme/resolve";
import type { MediaView, TemplateDefinition } from "@/templates/contract";
import { MediaField } from "./MediaField";
import { renderWithIntl } from "./test-helpers";

const readVideoDuration = vi.fn();
const capturePoster = vi.fn();
vi.mock("@/lib/media/video", () => ({
  readVideoDuration: (file: File) => readVideoDuration(file),
  capturePoster: (file: File) => capturePoster(file),
  POSTER_SECONDS: 0.1,
}));

const readImageSize = vi.fn();
vi.mock("@/lib/media/image", () => ({ readImageSize: (file: File) => readImageSize(file) }));

// The crop dialog needs a browser: a stand-in that shows what it frames and applies a fixed crop.
const DIALOG_CROP: CropRect = { x: 0.125, y: 0, width: 0.75, height: 1 };
const AVATAR_CROP: CropRect = { x: 1 / 6, y: 0, width: 2 / 3, height: 1 };
vi.mock("./crop/HeaderCropDialog", () => ({
  HeaderCropDialog: ({
    source,
    initialCrop,
    onApply,
    onCancel,
  }: {
    source: File | string;
    initialCrop?: CropRect | null;
    onApply: (crop: CropRect) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="header-crop-dialog" data-source={typeof source === "string" ? source : source.name} data-initial={JSON.stringify(initialCrop ?? null)}>
      <button type="button" onClick={() => onApply(DIALOG_CROP)}>
        Appliquer
      </button>
      <button type="button" onClick={onCancel}>
        Annuler
      </button>
    </div>
  ),
}));

// The profile photo dialog stands in the same way.
vi.mock("./crop/AvatarCropDialog", () => ({
  AvatarCropDialog: ({
    source,
    initialCrop,
    onApply,
    onCancel,
  }: {
    source: File | string;
    initialCrop?: CropRect | null;
    onApply: (crop: CropRect) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="avatar-crop-dialog" data-source={typeof source === "string" ? source : source.name} data-initial={JSON.stringify(initialCrop ?? null)}>
      <button type="button" onClick={() => onApply(AVATAR_CROP)}>
        Appliquer
      </button>
      <button type="button" onClick={onCancel}>
        Annuler
      </button>
    </div>
  ),
}));

const media = (id: string, kind: MediaView["kind"] = "image"): MediaView => ({
  id,
  kind,
  images: [{ width: 640, url: `https://media.example.test/${id}/w640.webp` }],
  ...(kind === "video" ? { video_url: `https://media.example.test/${id}/video.mp4` } : {}),
});

const ALL: TemplateDefinition<unknown>["media"] = { header: ["image", "video"], avatar: true };

const reframable = (id: string): MediaView => ({
  ...media(id),
  crop: { x: 0, y: 0.1, width: 1, height: 0.8 },
  source: { url: `https://media.example.test/${id}/source.webp?sig=1`, width: 1200, height: 1125 },
});

function Harness({
  declared = ALL,
  upload,
  reframe = vi.fn(),
  initial = { header: null, avatar: null },
}: {
  declared?: TemplateDefinition<unknown>["media"];
  upload: (...args: unknown[]) => Promise<MediaView>;
  reframe?: (...args: unknown[]) => Promise<MediaView>;
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
        reframe={reframe}
        theme={resolveTheme({ preset: "craie" })}
        name="Zoé Lefèvre ✨"
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
  readImageSize.mockReset().mockResolvedValue({ width: 800, height: 600 });
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
    expect(upload).toHaveBeenCalledWith("header", expect.any(File), undefined, undefined);
  });

  test("MED-003 MED-028 a video is sent with the poster captured from it and its time", async () => {
    const upload = vi.fn().mockResolvedValue(media("clip", "video"));
    renderWithIntl(<Harness upload={upload} />);

    pick("media-header-input", mp4());

    await waitFor(() => expect(state().header).toBe("clip"));
    expect(upload).toHaveBeenCalledWith("header", expect.any(File), expect.any(Blob), { posterTime: 0.1 });
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

  test("MED-021 an unreadable video shows a message and the field is usable again", async () => {
    readVideoDuration.mockRejectedValue(new Error("The video cannot be read."));
    const upload = vi.fn();
    renderWithIntl(<Harness upload={upload} />);

    pick("media-header-input", mp4());

    expect(await screen.findByTestId("media-header-error")).toHaveTextContent("Ce fichier ne peut pas être lu par le navigateur");
    expect(upload).not.toHaveBeenCalled();
    expect(screen.getByTestId("media-header-choose")).toBeEnabled();
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

  test("MED-005 EDI-035 the original file is uploaded with its crop", async () => {
    const upload = vi.fn().mockResolvedValue(media("face"));
    renderWithIntl(<Harness upload={upload} />);

    pick("media-avatar-input", jpeg());
    const dialog = await screen.findByTestId("avatar-crop-dialog");
    expect(dialog).toHaveAttribute("data-source", "photo.jpg");
    expect(upload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Appliquer" }));

    await waitFor(() => expect(state().avatar).toBe("face"));
    const [slot, sent, poster, framing] = upload.mock.calls[0] as [string, File, unknown, unknown];
    expect(slot).toBe("avatar");
    expect(sent.name).toBe("photo.jpg");
    expect(poster).toBeUndefined();
    expect(framing).toEqual({ crop: AVATAR_CROP });
    expect(screen.queryByTestId("avatar-crop-dialog")).toBeNull();
  });

  test("EDI-035 a square photo is sent as it is, and cancelling the dialog sends nothing", async () => {
    const upload = vi.fn().mockResolvedValue(media("square"));
    renderWithIntl(<Harness upload={upload} />);

    readImageSize.mockResolvedValue({ width: 900, height: 900 });
    pick("media-avatar-input", jpeg());
    await waitFor(() => expect(state().avatar).toBe("square"));
    expect(screen.queryByTestId("avatar-crop-dialog")).toBeNull();
    expect(upload).toHaveBeenCalledWith("avatar", expect.any(File), undefined, undefined);

    readImageSize.mockResolvedValue({ width: 600, height: 800 });
    pick("media-avatar-input", jpeg());
    fireEvent.click(await screen.findByRole("button", { name: "Annuler" }));
    expect(screen.queryByTestId("avatar-crop-dialog")).toBeNull();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  test("MED-021 a profile photo the browser cannot decode is reported, nothing is sent", async () => {
    readImageSize.mockRejectedValue(new Error("undecodable"));
    const upload = vi.fn();
    renderWithIntl(<Harness upload={upload} />);

    pick("media-avatar-input", jpeg());

    expect(await screen.findByTestId("media-avatar-error")).toHaveTextContent("Ce fichier ne peut pas être lu par le navigateur");
    expect(upload).not.toHaveBeenCalled();
  });

  test("EDI-035 MED-030 « Recadrer » re-frames the profile photo from its source", async () => {
    const reframe = vi.fn().mockResolvedValue(media("reframed-face"));
    renderWithIntl(<Harness upload={vi.fn()} reframe={reframe} initial={{ header: null, avatar: reframable("face") }} />);

    fireEvent.click(screen.getByTestId("media-avatar-crop"));

    const dialog = screen.getByTestId("avatar-crop-dialog");
    expect(dialog).toHaveAttribute("data-source", "https://media.example.test/face/source.webp?sig=1");
    expect(JSON.parse(dialog.getAttribute("data-initial")!)).toEqual({ x: 0, y: 0.1, width: 1, height: 0.8 });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer" }));

    await waitFor(() => expect(state().avatar).toBe("reframed-face"));
    expect(reframe).toHaveBeenCalledWith("face", { crop: AVATAR_CROP });
  });

  test("MED-030 a profile photo without source cannot be re-framed", () => {
    renderWithIntl(<Harness upload={vi.fn()} initial={{ header: null, avatar: media("legacy") }} />);

    const crop = screen.getByTestId("media-avatar-crop");
    expect(crop).toBeDisabled();
    expect(crop).toHaveAccessibleDescription("Remplace ce média pour pouvoir le recadrer.");
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

  test("EDI-026 a non-4:3 file opens the dialog before upload", async () => {
    readImageSize.mockResolvedValue({ width: 1280, height: 720 });
    const upload = vi.fn().mockResolvedValue(media("framed"));
    renderWithIntl(<Harness upload={upload} />);

    pick("media-header-input", jpeg());

    const dialog = await screen.findByTestId("header-crop-dialog");
    expect(dialog).toHaveAttribute("data-source", "photo.jpg");
    expect(upload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Appliquer" }));

    await waitFor(() => expect(state().header).toBe("framed"));
    expect(upload).toHaveBeenCalledWith("header", expect.any(File), undefined, { crop: DIALOG_CROP });
    expect(screen.queryByTestId("header-crop-dialog")).toBeNull();
  });

  test("EDI-026 a 4:3 photo is sent as it is, and cancelling the dialog sends nothing", async () => {
    const upload = vi.fn().mockResolvedValue(media("as-is"));
    renderWithIntl(<Harness upload={upload} />);

    pick("media-header-input", jpeg());
    await waitFor(() => expect(state().header).toBe("as-is"));
    expect(screen.queryByTestId("header-crop-dialog")).toBeNull();

    readImageSize.mockResolvedValue({ width: 600, height: 800 });
    pick("media-header-input", jpeg());
    fireEvent.click(await screen.findByRole("button", { name: "Annuler" }));
    expect(screen.queryByTestId("header-crop-dialog")).toBeNull();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  test("MED-021 a photo the browser cannot decode is reported before any upload", async () => {
    readImageSize.mockRejectedValue(new Error("undecodable"));
    const upload = vi.fn();
    renderWithIntl(<Harness upload={upload} />);

    pick("media-header-input", jpeg());

    expect(await screen.findByTestId("media-header-error")).toHaveTextContent("Ce fichier ne peut pas être lu par le navigateur");
    expect(upload).not.toHaveBeenCalled();
  });

  test("EDI-026 MED-030 « Recadrer » re-frames the header photo from its source", async () => {
    const reframe = vi.fn().mockResolvedValue(media("reframed"));
    renderWithIntl(<Harness upload={vi.fn()} reframe={reframe} initial={{ header: reframable("current"), avatar: null }} />);

    fireEvent.click(screen.getByRole("button", { name: "Recadrer" }));

    const dialog = screen.getByTestId("header-crop-dialog");
    expect(dialog).toHaveAttribute("data-source", "https://media.example.test/current/source.webp?sig=1");
    expect(JSON.parse(dialog.getAttribute("data-initial")!)).toEqual({ x: 0, y: 0.1, width: 1, height: 0.8 });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer" }));

    await waitFor(() => expect(state().header).toBe("reframed"));
    expect(reframe).toHaveBeenCalledWith("current", { crop: DIALOG_CROP });
  });

  test("MED-030 a refused re-framing is shown and the draft keeps its media", async () => {
    const refusal = new ApiError({ status: 409, code: "media_not_reframable", message: "m", requestId: "r1", fields: [] });
    const reframe = vi.fn().mockRejectedValue(refusal);
    renderWithIntl(<Harness upload={vi.fn()} reframe={reframe} initial={{ header: reframable("current"), avatar: null }} />);

    fireEvent.click(screen.getByRole("button", { name: "Recadrer" }));
    fireEvent.click(screen.getByRole("button", { name: "Appliquer" }));

    expect(await screen.findByTestId("media-header-error")).toHaveTextContent("Remplace ce média pour pouvoir le recadrer.");
    expect(state().header).toBe("current");
  });

  test("MED-030 MED-033 a media without source cannot be re-framed", () => {
    renderWithIntl(<Harness upload={vi.fn()} initial={{ header: media("legacy"), avatar: null }} />);

    const crop = screen.getByRole("button", { name: "Recadrer" });
    expect(crop).toBeDisabled();
    expect(crop).toHaveAccessibleDescription("Remplace ce média pour pouvoir le recadrer.");
    expect(screen.getByRole("button", { name: "Remplacer" })).toBeEnabled();
  });

  test("EDI-026 the header shows its kind and the length of a video", () => {
    const { unmount } = renderWithIntl(<Harness upload={vi.fn()} initial={{ header: reframable("photo"), avatar: null }} />);
    expect(screen.getByTestId("media-header-current")).toHaveTextContent("Photo");
    expect(screen.getByText("Image ou courte vidéo (lue sans le son). Format 4:3 conseillé ; garde le sujet dans la moitié haute.")).toBeInTheDocument();
    unmount();

    const video = { ...media("clip", "video"), duration_seconds: 8.6 };
    renderWithIntl(<Harness upload={vi.fn()} initial={{ header: video, avatar: null }} />);
    expect(screen.getByTestId("media-header-current")).toHaveTextContent("Vidéo · 9 s");
  });
});
