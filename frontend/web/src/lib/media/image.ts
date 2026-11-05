/**
 * spec: EDI-026, MED-021. The dimensions of an image file, turned the right way up as the browser shows it (and
 * as the server keeps its source, MED-025). Rejects when the browser cannot decode it.
 */
export async function readImageSize(file: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}
