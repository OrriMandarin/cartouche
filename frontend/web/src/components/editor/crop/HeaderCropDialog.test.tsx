import { fireEvent, screen } from "@testing-library/react";
import { useEffect } from "react";
import type { CropperProps } from "react-easy-crop";
import { describe, expect, test, vi } from "vitest";
import { resolveTheme } from "@/lib/theme/resolve";
import { renderWithIntl } from "../test-helpers";
import { HeaderCropDialog } from "./HeaderCropDialog";

/** A 1280 × 720 photo shown 640 × 360 in the stage: its 4:3 frame is 480 × 360 at 100 %. */
const MEDIA = { width: 640, height: 360, naturalWidth: 1280, naturalHeight: 720 };
const FRAME = { width: 480, height: 360 };

/**
 * react-easy-crop needs a laid-out browser: a stand-in that reports the sizes above once and, like the real one,
 * turns its position and zoom into the area of the source in percentages.
 */
vi.mock("react-easy-crop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-easy-crop")>();
  function FakeCropper(props: Partial<CropperProps>) {
    const { crop = { x: 0, y: 0 }, zoom = 1 } = props;
    useEffect(() => {
      props.onCropSizeChange?.(FRAME);
      props.onMediaLoaded?.(MEDIA);
      if (props.initialCroppedAreaPercentages) {
        const initial = actual.getInitialCropFromCroppedAreaPercentages(props.initialCroppedAreaPercentages, MEDIA, 0, FRAME, 1, 3);
        props.onCropChange?.(initial.crop);
        props.onZoomChange?.(initial.zoom);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the media loads
    }, []);
    useEffect(() => {
      const area = {
        x: (((MEDIA.width - FRAME.width / zoom) / 2 - crop.x / zoom) / MEDIA.width) * 100,
        y: (((MEDIA.height - FRAME.height / zoom) / 2 - crop.y / zoom) / MEDIA.height) * 100,
        width: (FRAME.width / MEDIA.width / zoom) * 100,
        height: (FRAME.height / MEDIA.height / zoom) * 100,
      };
      props.onCropAreaChange?.(area, area);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- follows the position and zoom only
    }, [crop.x, crop.y, zoom]);
    return <div data-testid="fake-cropper" data-zoom={zoom} />;
  }
  return { ...actual, default: FakeCropper };
});

const theme = resolveTheme({ preset: "terracotta", header_gradient: 55 });

function renderDialog(props: Partial<Parameters<typeof HeaderCropDialog>[0]> = {}) {
  const onApply = vi.fn();
  const onCancel = vi.fn();
  renderWithIntl(
    <HeaderCropDialog
      source="https://media.example.test/source.webp"
      theme={theme}
      name="Éloïse D’Aubigné-Müller"
      onApply={onApply}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onApply, onCancel };
}

/** French typography: a no-break space before the percent sign. */
const percent = (n: number) => `${n}\u00a0%`;
const stage = () => screen.getByRole("application", { name: "Zone de recadrage. Flèches pour déplacer, plus et moins pour zoomer." });
const zoomSlider = () => screen.getByRole("slider", { name: "Zoom" });
const apply = () => fireEvent.click(screen.getByRole("button", { name: "Appliquer" }));
const lastCrop = (onApply: ReturnType<typeof vi.fn>) => onApply.mock.lastCall![0] as { x: number; y: number; width: number; height: number };

describe("HeaderCropDialog", () => {
  test("EDI-026 the dialog shows the frame, the covered zones and the preview", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Recadrer l’en-tête" })).toBeInTheDocument();
    expect(stage()).toBeInTheDocument();
    expect(screen.getByText("Fondu 55 %")).toBeInTheDocument();
    expect(screen.getByText("Photo de profil")).toBeInTheDocument();
    expect(screen.getByText("Fondu vers le fond de la carte")).toBeInTheDocument();
    expect(screen.getByText("Photo de profil et bouton pause")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sur ta carte" })).toBeInTheDocument();
    expect(screen.getByText("Éloïse D’Aubigné-Müller")).toBeInTheDocument();
    expect(screen.getByText("Pince pour zoomer, glisse pour déplacer.")).toBeInTheDocument();
    expect(zoomSlider()).toHaveAttribute("aria-valuetext", percent(100));
  });

  test("EDI-026 the covered zones can be hidden", () => {
    renderDialog();
    const toggle = screen.getByRole("switch", { name: "Afficher les zones couvertes" });
    expect(toggle).toBeChecked();
    expect(screen.getByTestId("covered-zones")).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).not.toBeChecked();
    expect(screen.queryByTestId("covered-zones")).toBeNull();
    expect(screen.queryByText("Fondu 55 %")).toBeNull();
  });

  test("EDI-026 MED-026 « Appliquer » sends the largest centred 4:3 crop by default", () => {
    const { onApply } = renderDialog();
    apply();
    expect(lastCrop(onApply)).toEqual({ x: 0.125, y: 0, width: 0.75, height: 1 });
  });

  test("EDI-026 the arrows move the photo and plus and minus zoom", () => {
    const { onApply } = renderDialog();

    fireEvent.keyDown(stage(), { key: "ArrowRight" });
    apply();
    expect(lastCrop(onApply).x).toBeCloseTo(0.11);

    fireEvent.keyDown(stage(), { key: "+" });
    expect(zoomSlider()).toHaveAttribute("aria-valuetext", percent(110));
    fireEvent.keyDown(stage(), { key: "-" });
    fireEvent.keyDown(stage(), { key: "-" });
    expect(zoomSlider()).toHaveAttribute("aria-valuetext", percent(100));

    fireEvent.click(screen.getByRole("button", { name: "Zoomer" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoomer" }));
    expect(zoomSlider()).toHaveAttribute("aria-valuetext", percent(120));
    apply();
    expect(lastCrop(onApply).width).toBeCloseTo(0.75 / 1.2);

    fireEvent.click(screen.getByRole("button", { name: "Dézoomer" }));
    expect(zoomSlider()).toHaveAttribute("aria-valuetext", percent(110));
  });

  test("EDI-026 MED-030 a stored crop is where re-framing starts, « Réinitialiser » goes back to the default", () => {
    const { onApply } = renderDialog({ initialCrop: { x: 0.3, y: 0.2, width: 0.375, height: 0.5 } });
    expect(zoomSlider()).toHaveAttribute("aria-valuetext", percent(200));
    apply();
    const stored = lastCrop(onApply);
    expect(stored.x).toBeCloseTo(0.3);
    expect(stored.y).toBeCloseTo(0.2);

    fireEvent.click(screen.getByRole("button", { name: "Réinitialiser" }));
    expect(zoomSlider()).toHaveAttribute("aria-valuetext", percent(100));
    apply();
    expect(lastCrop(onApply)).toEqual({ x: 0.125, y: 0, width: 0.75, height: 1 });
  });

  test("EDI-026 « Annuler » closes without sending", () => {
    const { onApply, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});
