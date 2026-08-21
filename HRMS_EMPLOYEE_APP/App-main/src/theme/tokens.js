// src/theme/tokens.js
//
// Scheme-independent tokens. Anything that changes between light and dark
// lives in palettes.js and is read through useTheme() — keeping colour out of
// this file is what prevents a component from accidentally hard-coding a
// light-mode value that then ships broken in dark mode.

import { Platform, Dimensions, PixelRatio } from "react-native";

// ── Responsive scale ──────────────────────────────────────────────────────
// One number that everything else derives from, so the app fits a 320dp
// budget phone, a 390dp mainstream phone and a 430dp Max without any screen
// containing a breakpoint.
//
// Baseline 390dp (iPhone 14 / most modern Androids). Clamped hard on both
// ends: below 0.88 the type stops being readable at arm's length, and above
// 1.12 a phone starts looking like a scaled-up phone rather than a bigger
// one. A tablet gets a wider gutter instead of bigger text — see layout.
//
// Read once at module scope on purpose: the app is portrait-locked
// (app.json orientation), so width does not change under the user, and a
// per-render Dimensions read would rebuild every StyleSheet on every frame.
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export const SCALE = clamp(SCREEN_W / 390, 0.88, 1.12);

/** Scale a dp value and snap it to the device pixel grid. */
export const ms = (n) => PixelRatio.roundToNearestPixel(n * SCALE);

export const screen = {
  width: SCREEN_W,
  height: SCREEN_H,
  // 360dp is the old-Android floor (Galaxy S8-era and most budget phones);
  // anything under it needs tighter gutters and one-line labels.
  isSmall: SCREEN_W < 360,
  isLarge: SCREEN_W >= 414,
  isTablet: SCREEN_W >= 600,
  // Short screens (16:9 era, and every phone in landscape) cannot afford the
  // full vertical rhythm.
  isShort: SCREEN_H < 700,
};

// ── Radius ────────────────────────────────────────────────────────────────
// Kept from the reference design system, because it is the part that still
// earns its place: radius encodes scale, so the larger the object the softer
// the corner, and nothing borrows a radius from a level it does not own.
export const radius = {
  shell: 0, // top bar, page frame
  card: ms(22), // the acted-on card
  band: ms(18), // a major surface
  panel: ms(18),
  sheet: ms(24), // bottom sheets
  control: ms(12), // buttons, inputs, segmented controls
  tag: ms(8), // status tags
  pill: 9999, // avatars, leaderboard rank chips
};

// ── Spacing ───────────────────────────────────────────────────────────────
export const spacing = {
  hair: ms(4),
  tight: ms(8),
  snug: ms(12),
  base: ms(16),
  loose: ms(24),
  section: ms(32),
  deck: ms(48),
};

export const layout = {
  topBarHeight: 52,
  // The nav pill floats clear of the screen edge rather than sitting flush.
  // These two numbers are what make it read as an object on the field
  // instead of a bar welded to the bottom of the display.
  tabBarHeight: ms(66),
  tabBarInset: ms(14),
  tabBarLift: ms(10),
  // A tablet gets margin, not bigger text: content stays at a readable
  // measure and the extra width becomes gutter.
  gutter: screen.isTablet ? ms(40) : screen.isSmall ? ms(12) : spacing.base,
  maxContentWidth: 560,
  hairlineWidth: Platform.OS === "web" ? 1 : StyleSheetHairline(),
};

// How far the last element of a scrolling page must clear the floating nav
// pill. Derived, not typed twice: the pill's own geometry is above, and this
// is the only correct way to combine it.
//
// This was copy-pasted as a local `TAB_CLEARANCE` const in six screens, which
// meant the pill could be moved in this file and six pages would still reserve
// the old space. `Screen` now applies it, so screens never mention it at all.
layout.tabClearance =
  layout.tabBarHeight + layout.tabBarInset + layout.tabBarLift + spacing.base;

function StyleSheetHairline() {
  // Avoids importing StyleSheet just for one constant at module scope.
  return 0.5;
}

// ── Elevation ─────────────────────────────────────────────────────────────
// Two vocabularies now: a normal drop shadow to seat a surface, and a neon
// GLOW keyed to an accent colour. The glow is what makes the interface feel
// lit rather than printed — but it is expensive to overdraw, so it belongs on
// focal elements only, never on every row in a list.
//
// ── HARD PLATFORM RULE: elevation requires an OPAQUE backgroundColor ───────
// On Android, `elevation` on a view whose backgroundColor is translucent
// draws a shadow the view cannot hide. React Native's background drawables
// (CompositeBackgroundDrawable.getOutline / CSSBackgroundDrawable.getOutline)
// never call Outline.setAlpha(), so Android believes every RN view is an
// opaque occluder regardless of its actual alpha. It therefore culls the spot
// shadow's umbra and leaves the penumbra crescent falling INSIDE the view's
// own rect, on the side toward the light — a dark band hugging the top edge
// of the panel, about 2–3dp at elevation 4.
//
// Framework Android views do not have this problem (GradientDrawable.getOutline
// reports alpha 0 for non-opaque shapes). It is an RN-Android defect and it is
// not patchable from app code. The only correct response is the rule above:
// never put elevation on a translucent surface. Since palettes.js now
// guarantees every surface token is opaque, this holds by construction — but
// it must not be lost the next time someone reaches for a custom background.
//
// Also note: a View `opacity` below 1 makes the caster alpha < 1, which sends
// Android down the transparent-occluder path and fills the ENTIRE umbra under
// the view. Express a dimmed state as a colour, never as opacity, on anything
// that carries elevation. (SlabCard's `recede` is the worked example.)
const shadow = (offsetY, radiusPx, opacity, elevation, color = "#000") =>
  Platform.select({
    ios: {
      shadowColor: color,
      shadowOffset: { width: 0, height: offsetY },
      shadowRadius: radiusPx,
      shadowOpacity: opacity,
    },
    android: { elevation },
    default: {
      boxShadow: `0 ${offsetY}px ${radiusPx}px rgba(0,0,0,${opacity})`,
    },
  });

export const elevation = {
  panel: shadow(8, 24, 0.22, 4),
  card: shadow(18, 40, 0.35, 10),
  bar: shadow(-4, 20, 0.25, 8),
};

/**
 * A tinted lift for focal elements.
 *
 * This used to be a zero-offset halo, which is decoration rather than depth —
 * light comes from somewhere, so a shadow that surrounds an object equally is
 * a glow effect pretending to be elevation. It now carries a real vertical
 * offset like every other shadow in the system; the accent only tints it.
 */
export function glow(color, strength = 0.35) {
  return Platform.select({
    ios: {
      shadowColor: color,
      shadowOffset: { width: 0, height: 10 },
      shadowRadius: 22,
      shadowOpacity: strength,
    },
    // Android elevation cannot tint. The component's border does that work;
    // declaring shadowColor here would be a no-op that reads as if it worked.
    //
    // This used to return { elevation: 8 } — which delivered no glow (the
    // whole point of this function is the tint, and Android cannot tint) while
    // doing real damage: callers pass the result through `style`, and Glass
    // spreads `style` LAST, so this silently OVERRODE elevation.panel's 4 with
    // 8 on exactly the panels meant to look most polished, doubling the
    // shadow displacement. Worse, PrimaryAction puts glow() on `primaryWrap`,
    // which has no backgroundColor at all — Android was drawing a shadow
    // beneath a fully transparent surface.
    //
    // Returning nothing lets each component's own elevation token stand.
    android: {},
    default: { boxShadow: `0 10px 28px ${color}` },
  });
}

// ── Motion ────────────────────────────────────────────────────────────────
// Durations are short on purpose. "Playful" comes from things responding
// instantly with a little overshoot, not from long animations — anything
// past ~300ms on a tap starts to feel like lag rather than polish.
export const motion = {
  fast: 140,
  base: 220,
  slow: 320,
  spring: { damping: 16, stiffness: 180, mass: 0.9 },
};

export default { radius, spacing, layout, elevation, glow, motion };
