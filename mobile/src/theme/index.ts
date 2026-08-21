import { Platform } from "react-native";

/**
 * Design tokens, mirroring the web app.
 *
 * The same brand ramp, the same warm-grey neutrals, the same radii — so an
 * employee who uses the portal on a laptop and the app on a phone is looking
 * at one product rather than two that share a logo.
 *
 * Kept as plain objects rather than a styling library: React Native has no
 * cascade, every value is resolved at render time anyway, and a dependency
 * that only renames `backgroundColor` is not worth the bundle.
 */

const brand = {
  50: "#eef2ff",
  100: "#e0e7ff",
  200: "#c7d2fe",
  300: "#a5b4fc",
  400: "#818cf8",
  500: "#6366f1",
  600: "#4f46e5",
  700: "#4338ca",
  800: "#3730a3",
  900: "#312e81",
};

export const lightColors = {
  brand,
  accent: "#06b6d4",

  surface: "#ffffff",
  surfaceMuted: "#f8fafc",
  surfaceSunken: "#f1f5f9",
  border: "#e2e8f0",
  borderStrong: "#cbd5e1",

  text: "#0f172a",
  textMuted: "#64748b",
  textSubtle: "#94a3b8",
  onBrand: "#ffffff",

  success: "#059669",
  successBg: "#ecfdf5",
  warning: "#d97706",
  warningBg: "#fffbeb",
  danger: "#dc2626",
  dangerBg: "#fef2f2",
  info: "#0284c7",
  infoBg: "#f0f9ff",

  overlay: "rgba(15, 23, 42, 0.55)",
};

/**
 * Dark is not the light palette inverted. Surfaces lift as they come forward
 * (a card is lighter than the page, not darker), and the brand steps down two
 * stops because a 600-weight indigo on near-black is glare rather than accent.
 */
export const darkColors: typeof lightColors = {
  brand,
  accent: "#22d3ee",

  surface: "#0f172a",
  surfaceMuted: "#1e293b",
  surfaceSunken: "#020617",
  border: "#1e293b",
  borderStrong: "#334155",

  text: "#f1f5f9",
  textMuted: "#94a3b8",
  textSubtle: "#64748b",
  onBrand: "#ffffff",

  success: "#34d399",
  successBg: "#064e3b",
  warning: "#fbbf24",
  warningBg: "#451a03",
  danger: "#f87171",
  dangerBg: "#450a0a",
  info: "#38bdf8",
  infoBg: "#082f49",

  overlay: "rgba(2, 6, 23, 0.7)",
};

export type Colors = typeof lightColors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 999,
};

/**
 * A type scale rather than ad-hoc sizes. `tabular` matters more than it looks:
 * clock times and balances that shift width as the digits change read as a
 * flicker on a screen that updates every second.
 */
export const type = {
  display: { fontSize: 32, fontWeight: "700" as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: "700" as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: "600" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  bodyMedium: { fontSize: 15, fontWeight: "500" as const },
  label: { fontSize: 13, fontWeight: "500" as const },
  caption: { fontSize: 12, fontWeight: "400" as const },
  tabular: Platform.select({
    ios: { fontVariant: ["tabular-nums" as const] },
    android: { fontFamily: "monospace" },
    default: {},
  }),
};

/**
 * Elevation, expressed once for both platforms. iOS wants a shadow and Android
 * wants an elevation number; writing both at every call site is how a card
 * ends up flat on one platform and not the other.
 */
export function shadow(level: 1 | 2 | 3, colors: Colors) {
  const config = {
    1: { height: 1, radius: 3, opacity: 0.06, elevation: 1 },
    2: { height: 4, radius: 12, opacity: 0.1, elevation: 3 },
    3: { height: 10, radius: 24, opacity: 0.16, elevation: 8 },
  }[level];

  return Platform.select({
    ios: {
      shadowColor: "#0f172a",
      shadowOffset: { width: 0, height: config.height },
      shadowOpacity: colors === darkColors ? config.opacity * 2 : config.opacity,
      shadowRadius: config.radius,
    },
    android: { elevation: config.elevation },
    default: {},
  });
}

/** Minimum touch target. Below this, taps start missing. */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };
export const MIN_TAP = 44;
