/** Colour maths for the card themes: WCAG luminance and contrast, Oklab mixing, alpha compositing. */

/** Encoded sRGB channels, each from 0 to 1. */
export type Rgb = readonly [number, number, number];

export function parseHex(hex: string): Rgb {
  const channel = (start: number) => parseInt(hex.slice(start, start + 2), 16) / 255;
  return [channel(1), channel(3), channel(5)];
}

export function toHex(rgb: Rgb): string {
  const byte = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(rgb[0])}${byte(rgb[1])}${byte(rgb[2])}`;
}

const linearize = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const encode = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * linearize(rgb[0]) + 0.7152 * linearize(rgb[1]) + 0.0722 * linearize(rgb[2]);
}

/** WCAG 2.x contrast ratio, from 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

type Oklab = readonly [number, number, number];

function toOklab(rgb: Rgb): Oklab {
  const [r, g, b] = [linearize(rgb[0]), linearize(rgb[1]), linearize(rgb[2])];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: Oklab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clampedEncode = (c: number) => encode(Math.min(1, Math.max(0, c)));
  return [
    clampedEncode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clampedEncode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clampedEncode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Mixes two colours in Oklab; `weightOfA` is the share of `a`, from 0 to 1. */
export function mixOklab(a: Rgb, b: Rgb, weightOfA: number): Rgb {
  const [oa, ob] = [toOklab(a), toOklab(b)];
  return fromOklab([
    oa[0] * weightOfA + ob[0] * (1 - weightOfA),
    oa[1] * weightOfA + ob[1] * (1 - weightOfA),
    oa[2] * weightOfA + ob[2] * (1 - weightOfA),
  ]);
}

/** A translucent `fg` laid over `bg`, on the encoded values, as a browser does. */
export function over(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return [
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ];
}
