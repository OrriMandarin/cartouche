import { fireEvent, screen } from "@testing-library/react";
import { useEffect } from "react";
import type { CropperProps } from "react-easy-crop";
import { describe, expect, test, vi } from "vitest";
import { renderWithIntl } from "../test-helpers";
import { AvatarCropDialog } from "./AvatarCropDialog";

/** A 1200 × 800 photo shown 600 × 400 in the stage: its square frame is 400 × 400 at 100 %. */
const MEDIA = { width: 600, height: 400, naturalWidth: 1200, naturalHeight: 800 };
const FRAME = { width: 400, height: 400 };

let lastProps: Partial<CropperProps> = {};

/** react-easy-crop needs a laid-out browser: a stand-in that reports the sizes above and the area of the source. */
vi.mock("react-easy-crop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-easy-crop")>();
  function FakeCropper(props: Partial<CropperProps>) {
    lastProps = props;
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

function renderDialog(props: Partial<Parameters<typeof AvatarCropDialog>[0]> = {}) {
  const onApply = vi.fn();
  const onCancel = vi.fn();
  renderWithIntl(<AvatarCropDialog source="https://media.example.test/face.webp" onApply={onApply} onCancel={onCancel} {...props} />);
  return { onApply, onCancel };
}

const stage = () => screen.getByRole("application", { name: "Zone de recadrage de la photo de profil" });
const apply = () => fireEvent.click(screen.getByRole("button", { name: "Appliquer" }));
const lastCrop = (onApply: ReturnType<typeof vi.fn>) => onApply.mock.lastCall![0] as { x: number; y: number; width: number; height: number };

describe("AvatarCropDialog", () => {
  test("EDI-035 the avatar dialog shows both preview sizes and applies a square crop", () => {
    const { onApply } = renderDialog();

    expect(screen.getByRole("dialog", { name: "Recadrer la photo de profil" })).toBeInTheDocument();
    expect(lastProps.cropShape).toBe("round");
    expect(lastProps.aspect).toBe(1);
    expect(screen.getByText("Sur la carte · 112 px")).toBeInTheDocument();
    expect(screen.getByText("Dans l’app · 36 px")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-preview-card")).toHaveStyle({ width: "112px", height: "112px" });
    expect(screen.getByTestId("avatar-preview-app")).toHaveStyle({ width: "36px", height: "36px" });
    expect(screen.getByText(/Centre le visage et laisse un peu d’air au-dessus de la tête/)).toBeInTheDocument();

    apply();
    // The largest centred square of a 1200 × 800 photo: 800 × 800, a third of the width from the left edge.
    const crop = lastCrop(onApply);
    expect(crop.x).toBeCloseTo(1 / 6);
    expect(crop.y).toBeCloseTo(0);
    expect(crop.width).toBeCloseTo(2 / 3);
    expect(crop.height).toBeCloseTo(1);
  });

  test("EDI-035 the stage has the focus, the arrows move the photo and plus zooms", () => {
    const { onApply } = renderDialog();
    expect(stage()).toHaveFocus();

    fireEvent.keyDown(stage(), { key: "+" });
    expect(screen.getByRole("slider", { name: "Zoom" })).toHaveAttribute("aria-valuetext", "110 %");
    fireEvent.keyDown(stage(), { key: "ArrowRight" });
    apply();
    expect(lastCrop(onApply).width).toBeCloseTo(2 / 3 / 1.1);
  });

  test("MED-030 a stored crop is where re-framing starts, « Réinitialiser » goes back to the default", () => {
    const { onApply } = renderDialog({ initialCrop: { x: 0.3, y: 0.2, width: 0.3, height: 0.45 } });
    expect(screen.getByRole("slider", { name: "Zoom" })).toHaveAttribute("aria-valuetext", "222 %");

    fireEvent.click(screen.getByRole("button", { name: "Réinitialiser" }));
    apply();
    expect(lastCrop(onApply).width).toBeCloseTo(2 / 3);
  });

  test("EDI-035 « Annuler » closes without sending", () => {
    const { onApply, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});
