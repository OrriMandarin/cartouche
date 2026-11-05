import { fireEvent, screen } from "@testing-library/react";
import { useEffect } from "react";
import type { CropperProps } from "react-easy-crop";
import { describe, expect, test, vi } from "vitest";
import { resolveTheme } from "@/lib/theme/resolve";
import { renderWithIntl } from "../test-helpers";
import { VideoCropDialog, type VideoFraming } from "./VideoCropDialog";

/** A 640 × 360 video shown as it is in the stage: its 4:3 frame is 480 × 360 at 100 %. */
const MEDIA = { width: 640, height: 360, naturalWidth: 640, naturalHeight: 360 };
const FRAME = { width: 480, height: 360 };

// react-easy-crop needs a laid-out browser: a stand-in that reports the centred 4:3 area of the video.
vi.mock("react-easy-crop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-easy-crop")>();
  function FakeCropper(props: Partial<CropperProps>) {
    useEffect(() => {
      props.onCropSizeChange?.(FRAME);
      props.onMediaLoaded?.(MEDIA);
      const area = { x: 12.5, y: 0, width: 75, height: 100 };
      props.onCropAreaChange?.(area, area);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the video loads
    }, []);
    return <div data-testid="fake-cropper" data-video={String(props.video)} />;
  }
  return { ...actual, default: FakeCropper };
});

// The strip's frames are drawn by the browser.
vi.mock("@/lib/media/video", () => ({
  POSTER_SECONDS: 0.1,
  captureFrames: (_source: File | string, count: number) =>
    Promise.resolve(Array.from({ length: count }, (_, index) => `data:image/jpeg;base64,frame${index}`)),
}));

const theme = resolveTheme({ preset: "terracotta", header_gradient: 55 });

function renderDialog(props: Partial<Parameters<typeof VideoCropDialog>[0]> = {}) {
  const onApply = vi.fn<(framing: VideoFraming) => void>();
  const onCancel = vi.fn();
  renderWithIntl(
    <VideoCropDialog
      video="https://media.example.test/video.mp4"
      duration={10}
      theme={theme}
      name="Zoé Lefèvre ✨"
      onApply={onApply}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onApply, onCancel };
}

const start = () => screen.getByRole("slider", { name: "Début de l’extrait" });
const end = () => screen.getByRole("slider", { name: "Fin de l’extrait" });
const playhead = () => screen.getByRole("slider", { name: "Tête de lecture" });
const apply = () => fireEvent.click(screen.getByRole("button", { name: "Appliquer" }));
const press = (element: HTMLElement, key: string, times = 1, shiftKey = false) => {
  for (let i = 0; i < times; i += 1) fireEvent.keyDown(element, { key, shiftKey });
};
/** French typography: a no-break space before the unit. */
const seconds = (text: string) => `${text}\u00a0s`;
/** Text as written, its no-break spaces kept. */
const exactText = (text: string) => screen.getByText(text, { normalizer: (content) => content });

describe("VideoCropDialog", () => {
  test("EDI-034 the dialog shows the video, its strip of frames and the play button", async () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: /Recadrer la vidéo d’en-tête/ })).toBeInTheDocument();
    expect(screen.getByTestId("fake-cropper")).toHaveAttribute("data-video", "https://media.example.test/video.mp4");
    expect(screen.getByRole("button", { name: "Lire l’extrait" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Extrait en boucle" })).toBeInTheDocument();
    expect(await screen.findAllByTestId("video-crop-frame")).toHaveLength(8);
    expect(screen.getByRole("switch", { name: "Afficher les zones couvertes" })).toBeChecked();
    expect(screen.getByRole("heading", { name: "Sur ta carte" })).toBeInTheDocument();
  });

  test("EDI-034 the handles keep a loop of at least one second", () => {
    const { onApply } = renderDialog({ duration: 7.5 });
    // By default, the whole video.
    expect(start()).toHaveAttribute("aria-valuetext", seconds("0,0"));
    expect(end()).toHaveAttribute("aria-valuetext", seconds("7,5"));

    press(start(), "ArrowRight", 8, true);
    expect(start()).toHaveAttribute("aria-valuetext", seconds("6,5"));
    press(end(), "ArrowLeft", 3);
    expect(end()).toHaveAttribute("aria-valuetext", seconds("7,5"));
    expect(exactText(`Boucle de ${seconds("1,0")}`)).toBeInTheDocument();

    press(start(), "ArrowLeft", 5);
    press(end(), "ArrowLeft", 3);
    apply();
    expect(onApply.mock.lastCall![0].loop).toEqual({ start: 6, end: 7.2 });
  });

  test("EDI-034 the loop length and times are written the French way", () => {
    renderDialog({ initialLoop: { start: 0.8, end: 8.3 }, initialPosterTime: 2.9 });
    expect(start()).toHaveAttribute("aria-valuetext", seconds("0,8"));
    expect(end()).toHaveAttribute("aria-valuetext", seconds("8,3"));
    expect(screen.getByText("0:00,8")).toBeInTheDocument();
    expect(screen.getByText("0:08,3")).toBeInTheDocument();
    expect(exactText(`Boucle de ${seconds("7,5")}`)).toBeInTheDocument();
    expect(screen.getByText("tête de lecture à 0:02,9")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Utiliser l’image à 0:02,9 comme image d’attente/ })).not.toBeChecked();
  });

  test("EDI-034 the poster box sends the frame at the playhead", () => {
    const { onApply } = renderDialog({ initialPosterTime: 2.9 });
    // The waiting image stays as it is unless the box is ticked.
    apply();
    expect(onApply.mock.lastCall![0]).toEqual({
      crop: { x: 0.125, y: 0, width: 0.75, height: 1 },
      loop: { start: 0, end: 10 },
      posterTime: 2.9,
      newPoster: false,
    });

    press(playhead(), "ArrowRight", 3);
    expect(screen.getByText("tête de lecture à 0:03,2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Utiliser l’image à 0:03,2 comme image d’attente/ }));
    apply();
    expect(onApply.mock.lastCall![0]).toMatchObject({ posterTime: 3.2, newPoster: true });
  });

  test("EDI-034 moving a handle shows its frame: the playhead follows it", () => {
    renderDialog({ initialPosterTime: 2.9 });
    press(start(), "ArrowRight", 4);
    expect(playhead()).toHaveAttribute("aria-valuetext", seconds("0,4"));
  });

  test("EDI-034 « Annuler » closes without sending", () => {
    const { onApply, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});
