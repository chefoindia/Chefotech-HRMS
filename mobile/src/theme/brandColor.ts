/**
 * Derives a full colour ramp from one brand hex — a direct port of the web
 * app's OKLCH scale builder (frontend/lib/theme.ts), so an organisation's
 * chosen colour produces the identical set of shades on the phone as it does
 * on the web portal. Same colour, same 50-through-900 steps, same product on
 * two screens.
 *
 * Pure arithmetic, no platform APIs — the same function runs on iOS, Android
 * and web without a native colour-management dependency.
 */

export interface BrandScale {
  50: string; 100: string; 200: string; 300: string; 400: string;
  500: string; 600: string; 700: string; 800: string; 900: string;
}

function normaliseHex(hex: string): string {
  let value = hex.replace("#", "");
  if (value.length === 3) value = value.split("").map((c) => c + c).join("");
  return `#${value.toLowerCase()}`;
}

function hexToRgb(hex: string) {
  const value = normaliseHex(hex).slice(1);
  if (!/^[0-9a-f]{6}$/.test(value)) return null;
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
  };
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToOklch({ r, g, b }: { r: number; g: number; b: number }) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  return { l: okL, c: Math.sqrt(okA * okA + okB * okB), h: (Math.atan2(okB, okA) * 180) / Math.PI };
}

function oklchToHex({ l, c, h }: { l: number; c: number; h: number }) {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const r = linearToSrgb(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_);
  const g = linearToSrgb(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_);
  const blue = linearToSrgb(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_);

  const toHex = (channel: number) =>
    Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(blue)}`;
}

// Numeric literals, not strings: an interface with keys like `50: string`
// resolves `keyof` to the number type, not "50", because that is how object
// property keys work — a plain `{50: "x"}` is number-indexed under the hood.
const SCALE_STEPS: Array<[keyof BrandScale, number, number]> = [
  [50, 0.971, 0.16], [100, 0.936, 0.28], [200, 0.885, 0.45],
  [300, 0.811, 0.65], [400, 0.71, 0.85], [500, 0.62, 1],
  [600, 0.548, 1], [700, 0.481, 0.92], [800, 0.42, 0.82], [900, 0.375, 0.72],
];

/** Falls back to nothing (caller keeps the default indigo ramp) on a bad hex. */
export function buildBrandScale(hex: string): BrandScale | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const base = rgbToOklch(rgb);

  const out = {} as BrandScale;
  for (const [step, lightness, chromaFactor] of SCALE_STEPS) {
    out[step] = oklchToHex({ l: lightness, c: base.c * chromaFactor, h: base.h });
  }
  // Used verbatim at 600 — the exact colour the admin picked, unrounded.
  out[600] = normaliseHex(hex);
  return out;
}
