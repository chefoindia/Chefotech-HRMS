import type { Branding } from "./types";

/**
 * Runtime theming.
 *
 * The organization's branding is written into CSS custom properties on
 * <html>, which every component already reads through Tailwind's theme
 * tokens. Changing a colour in Settings updates the entire application —
 * buttons, links, charts, the sidebar — without a rebuild and without any
 * component knowing a brand colour exists.
 */

const RADIUS: Record<string, string> = {
  none: "0px",
  small: "0.375rem",
  medium: "0.625rem",
  large: "1rem",
};

export function applyBranding(branding: Partial<Branding> | null | undefined) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  if (branding?.primaryColor) {
    const scale = buildScale(branding.primaryColor);
    for (const [step, value] of Object.entries(scale)) {
      root.style.setProperty(`--brand-${step}`, value);
    }
  }

  if (branding?.accentColor) root.style.setProperty("--accent", branding.accentColor);

  if (branding?.sidebarStyle) {
    const sidebar = {
      dark: { bg: "#0f172a", fg: "#cbd5e1" },
      light: { bg: "#ffffff", fg: "#475569" },
      brand: { bg: branding.primaryColor || "#4f46e5", fg: "rgba(255,255,255,0.85)" },
    }[branding.sidebarStyle];

    root.style.setProperty("--sidebar-bg", sidebar.bg);
    root.style.setProperty("--sidebar-fg", sidebar.fg);
  }

  if (branding?.borderRadius) {
    root.style.setProperty("--radius", RADIUS[branding.borderRadius] || RADIUS.medium);
  }

  if (branding?.fontFamily) {
    root.style.setProperty("--font-family", `"${branding.fontFamily}"`);
  }
}

export function resetBranding() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const property of [
    "--brand-50", "--brand-100", "--brand-200", "--brand-300", "--brand-400",
    "--brand-500", "--brand-600", "--brand-700", "--brand-800", "--brand-900",
    "--accent", "--sidebar-bg", "--sidebar-fg", "--radius", "--font-family",
  ]) {
    root.style.removeProperty(property);
  }
}

/**
 * Derive a 10-step palette from one hex colour.
 *
 * A tenant picks a single brand colour; the UI needs tints for hovers,
 * backgrounds and borders. Interpolating in OKLCH rather than sRGB keeps the
 * lighter steps from going grey and muddy, which is what naive hex blending
 * does to saturated blues and greens.
 */
export function buildScale(hex: string): Record<string, string> {
  const rgb = hexToRgb(hex);
  if (!rgb) return {};

  const base = rgbToOklch(rgb);

  // Lightness targets matched to the Tailwind ramp, so a brand colour drops in
  // where indigo-600 was and everything still reads correctly.
  const steps: Array<[string, number, number]> = [
    ["50", 0.971, 0.16],
    ["100", 0.936, 0.28],
    ["200", 0.885, 0.45],
    ["300", 0.811, 0.65],
    ["400", 0.71, 0.85],
    ["500", 0.62, 1],
    ["600", 0.548, 1],
    ["700", 0.481, 0.92],
    ["800", 0.42, 0.82],
    ["900", 0.375, 0.72],
  ];

  const out: Record<string, string> = {};
  for (const [step, lightness, chromaFactor] of steps) {
    out[step] = oklchToHex({
      l: lightness,
      c: base.c * chromaFactor,
      h: base.h,
    });
  }

  // The chosen colour is used verbatim at 600, the step buttons use, so the
  // brand appears exactly as the customer picked it.
  out["600"] = normaliseHex(hex);
  return out;
}

// ── Colour maths ────────────────────────────────────────────────────────────

function normaliseHex(hex: string) {
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

function srgbToLinear(channel: number) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number) {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

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

  return {
    l: okL,
    c: Math.sqrt(okA * okA + okB * okB),
    h: (Math.atan2(okB, okA) * 180) / Math.PI,
  };
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
    Math.round(Math.min(1, Math.max(0, channel)) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(blue)}`;
}

/** Readable foreground for a given background. Used by badges and charts. */
export function readableTextColor(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#0f172a";
  const luminance =
    0.2126 * srgbToLinear(rgb.r) + 0.7152 * srgbToLinear(rgb.g) + 0.0722 * srgbToLinear(rgb.b);
  return luminance > 0.45 ? "#0f172a" : "#ffffff";
}

/** A stable colour for charts, derived from a label. */
export const CHART_COLORS = [
  "#4f46e5", "#06b6d4", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1",
];

export function colorForIndex(index: number) {
  return CHART_COLORS[index % CHART_COLORS.length];
}
