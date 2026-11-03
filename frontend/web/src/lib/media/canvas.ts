/** JPEG of a canvas (quality 0.85). */
export function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The image cannot be encoded."))), "image/jpeg", 0.85);
  });
}
