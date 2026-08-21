// src/theme/typography.js
//
// One neo-grotesque doing every job, differentiated by weight and tracking
// rather than by family. A second family would be decoration.
//
// Three RN adaptations from the web spec, all deliberate:
//
//  1. `clamp(min, vw, max)` collapses to its MINIMUM. Every clamp in the spec
//     is tuned for a 1280px deck; on a phone the viewport term never wins, so
//     the min is the honest mobile value.
//  2. `letterSpacing` is em in CSS and px in RN — each value is multiplied out
//     against its own font size.
//  3. `lineHeight` is a ratio in CSS and absolute px in RN — same treatment.
//
// Weights 350 and 450 in the spec round to 400 and 500. React Native only
// honours hundred-step weights, and a non-standard value silently falls back
// to regular on Android — which would flatten the hierarchy rather than
// refine it.

import { Platform } from "react-native";
import { ms } from "./tokens";

// Sizes run through ms() so type tracks the device: a 34px display on a
// 320dp phone would wrap every name, and the same size on a 430dp phone reads
// undersized. See SCALE in tokens.js — clamped to 0.88–1.12 so this refines
// the fit rather than becoming a different design per device.
//
// Manrope. Chosen over the platform UI font because Roboto and San Francisco
// are the two faces every phone already wears — an app that uses them has no
// typographic voice at all, it just inherits the OS's.
//
// Manrope is a semi-condensed geometric grotesk: its narrow set width fits
// long Indian names and job titles at display size without shrinking the
// type, and its flat-sided round forms and high x-height stay legible at
// caption size on a mid-range screen held at arm's length. It also ships as
// TTF assets with no native code, so it works on the current build.
//
// React Native has no synthetic weight mapping for custom fonts: `fontWeight`
// is ignored once `fontFamily` names a static face. Every weight must
// therefore be its own family name, which is why the scale below names faces
// rather than setting numeric weights.
export const FONT = {
  light: "Manrope_300Light",
  regular: "Manrope_400Regular",
  medium: "Manrope_500Medium",
  semibold: "Manrope_600SemiBold",
  bold: "Manrope_700Bold",
  extrabold: "Manrope_800ExtraBold",
};

// Kept for anything still importing the old name.
export const FONT_FAMILY = FONT.regular;

// Tabular figures throughout. Numbers in this product sit in columns and
// change in place; proportional digits make them jitter.
const TABULAR = Platform.OS === "web" ? {} : { fontVariant: ["tabular-nums"] };

export const type = {
  // Greeting and the composite score figure. One per view.
  display: {
    fontFamily: FONT.extrabold,
    fontSize: ms(34),
    lineHeight: ms(38),
    letterSpacing: ms(-1.4),
  },

  // A person's name on a slab card.
  headline: {
    fontFamily: FONT.bold,
    fontSize: ms(24),
    lineHeight: ms(26),
    letterSpacing: ms(-0.72),
  },

  // The wordmark beside the mark, and nowhere else.
  wordmark: {
    fontFamily: FONT.bold,
    fontSize: ms(17),
    lineHeight: ms(17),
    letterSpacing: ms(-0.51),
  },

  // Navigation, panel headings, task names, control labels.
  title: {
    fontFamily: FONT.semibold,
    fontSize: ms(15),
    lineHeight: ms(20),
    letterSpacing: ms(-0.18),
  },

  // Prose and list content.
  body: {
    fontFamily: FONT.regular,
    fontSize: ms(14),
    lineHeight: ms(21),
    letterSpacing: ms(-0.11),
  },

  // Every number that is a value rather than prose. Always tabular.
  figure: {
    fontFamily: FONT.bold,
    fontSize: ms(22),
    lineHeight: ms(22),
    letterSpacing: ms(-0.55),
    ...TABULAR,
  },

  // The headline number in a metric-strip cell, where several figures are
  // compared across a row at a glance. A figure step, not a heading step —
  // it never carries prose.
  figureLarge: {
    fontFamily: FONT.extrabold,
    fontSize: ms(28),
    lineHeight: ms(28),
    letterSpacing: ms(-0.84),
    ...TABULAR,
  },

  // Metadata, column headers, secondary stat units.
  caption: {
    fontFamily: FONT.medium,
    fontSize: ms(12),
    lineHeight: ms(16),
    letterSpacing: ms(-0.05),
  },

  // The single tracked kicker in a greeting row, and the label of a metric
  // cell. See The One Kicker Rule — a tracked eyebrow above a panel, a list
  // or a form is a defect; those take Title.
  label: {
    fontFamily: FONT.semibold,
    fontSize: ms(11),
    lineHeight: ms(13),
    letterSpacing: ms(0.99),
    textTransform: "uppercase",
  },
};

export default type;
