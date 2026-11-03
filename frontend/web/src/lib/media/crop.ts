import { canvasToJpeg } from "./canvas";

/** A square (or any) area of an image, in the pixels of the original. */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Biggest side of the cropped photo; the server makes the final sizes (MED-015). */
const DEFAULT_SIZE = 1024;

/**
 * spec: MED-005. The chosen area of a photo as a square JPEG. It is never enlarged beyond the area's own width.
 */
export async function cropToSquare(image: Blob, area: CropArea, size = DEFAULT_SIZE): Promise<Blob> {
  const bitmap = await createImageBitmap(image);
  try {
    const side = Math.max(1, Math.min(size, Math.round(area.width)));
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas available.");
    // A transparent PNG would turn black as a JPEG.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, side, side);
    context.drawImage(bitmap, area.x, area.y, area.width, area.height, 0, 0, side, side);
    return await canvasToJpeg(canvas);
  } finally {
    bitmap.close();
  }
}
