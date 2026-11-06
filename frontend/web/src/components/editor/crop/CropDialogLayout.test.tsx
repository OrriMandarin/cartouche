import { fireEvent, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import type { CropperProps } from "react-easy-crop";
import { describe, expect, test, vi } from "vitest";
import { resolveTheme } from "@/lib/theme/resolve";
import { renderWithIntl } from "../test-helpers";
import { HeaderCropDialog } from "./HeaderCropDialog";

/**
 * Like react-easy-crop before its media has loaded: it first reports an area measured on the element's default size,
 * whose pixel size is 0 × 0, and only reports the real 4:3 area once the test loads the media.
 */
vi.mock("react-easy-crop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-easy-crop")>();
  function LoadingCropper(props: Partial<CropperProps>) {
    const [loaded, setLoaded] = useState(false);
    useEffect(() => {
      const placeholder = { x: 16.67, y: 0, width: 66.67, height: 100 };
      props.onCropAreaChange?.(placeholder, { x: 0, y: 0, width: 0, height: 0 });
      // eslint-disable-next-line react-hooks/exhaustive-deps -- once, before the media loads
    }, []);
    useEffect(() => {
      if (!loaded) return;
      const area = { x: 12.5, y: 0, width: 75, height: 100 };
      props.onCropAreaChange?.(area, { x: 240, y: 0, width: 1440, height: 1080 });
      // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the media loads
    }, [loaded]);
    return (
      <button type="button" onClick={() => setLoaded(true)}>
        load
      </button>
    );
  }
  return { ...actual, default: LoadingCropper };
});

const theme = resolveTheme({ preset: "terracotta", header_gradient: 55 });

describe("CropDialogLayout", () => {
  test("MED-026 EDI-026 « Appliquer » waits for the area of the loaded media, never sends the one measured before", () => {
    const onApply = vi.fn();
    renderWithIntl(
      <HeaderCropDialog
        source="https://media.example.test/source.webp"
        theme={theme}
        name="Éloïse D’Aubigné-Müller"
        onApply={onApply}
        onCancel={vi.fn()}
      />,
    );
    const apply = screen.getByRole("button", { name: "Appliquer" });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "load" }));
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledTimes(1);
    const crop = onApply.mock.lastCall![0] as { x: number; y: number; width: number; height: number };
    expect(crop.x).toBeCloseTo(0.125);
    expect(crop.width).toBeCloseTo(0.75);
    expect(crop.height).toBeCloseTo(1);
  });
});
