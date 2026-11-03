import QRCode from "qrcode";

// Quiet zone of 2 modules and error correction level M, for every QR code of a card.
const SVG_OPTIONS = { type: "svg", margin: 2, errorCorrectionLevel: "M" } as const;
const PNG_OPTIONS = { margin: 2, errorCorrectionLevel: "M" } as const;

/** spec: LNK-029. The QR code of a card's public url, as SVG markup. */
export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, SVG_OPTIONS);
}

/** spec: LNK-029. The QR code of a card's public url, as a PNG image. */
export async function qrPng(url: string): Promise<Blob> {
  const dataUrl = await QRCode.toDataURL(url, PNG_OPTIONS);
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: "image/png" });
}

/** spec: LNK-017. Name of the downloaded QR code file: `<slug>.svg` or `<slug>.png`. */
export function qrFileName(slug: string, format: "svg" | "png"): string {
  return `${slug}.${format}`;
}

/** Hands a blob to the browser as a download. */
export function saveBlob(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
