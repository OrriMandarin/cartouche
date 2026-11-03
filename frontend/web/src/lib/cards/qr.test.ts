import QRCode from "qrcode";
import { afterEach, describe, expect, test, vi } from "vitest";
import { qrFileName, qrPng, qrSvg } from "./qr";

const URL_OF_CARD = "http://localhost:13000/c/alice-durand";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("QR codes", () => {
  test("LNK-029 LNK-017 the SVG QR code encodes the public url", async () => {
    const toString = vi.spyOn(QRCode, "toString");
    const svg = await qrSvg(URL_OF_CARD);
    expect(svg.startsWith("<svg") || svg.startsWith("<?xml")).toBe(true);
    expect(svg).toContain("<svg");
    expect(toString).toHaveBeenCalledWith(URL_OF_CARD, expect.objectContaining({ type: "svg", margin: 2, errorCorrectionLevel: "M" }));
  });

  test("LNK-029 LNK-017 the PNG QR code encodes the public url", async () => {
    const toDataURL = vi.spyOn(QRCode, "toDataURL");
    const blob = await qrPng(URL_OF_CARD);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
    expect(toDataURL).toHaveBeenCalledWith(URL_OF_CARD, expect.objectContaining({ margin: 2, errorCorrectionLevel: "M" }));
    const header = new Uint8Array(await blob.arrayBuffer()).slice(0, 4);
    expect(Array.from(header)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test("LNK-017 downloads are named after the slug", () => {
    expect(qrFileName("alice-durand", "svg")).toBe("alice-durand.svg");
    expect(qrFileName("alice-durand", "png")).toBe("alice-durand.png");
  });
});
