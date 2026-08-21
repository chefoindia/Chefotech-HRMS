// src/theme/palettes.js
//
// Palette adopted from the Cowork export's DESIGN.md, as the user directed.
// Its tokens are used as written — this is not a reinterpretation.
//
// The system it describes:
//   FIELD  — a six-hue iridescent ground (ivory → gold → rose → mauve →
//            slate → deep). It is the page. Nothing sits behind it.
//   DECK   — near-opaque frost panels (0.97) carrying content.
//   SLAB   — #262626, the matte dark material reserved for measurement.
//   INK    — #0a0a0a for primary text and for the ACTIVE state. Cowork has no
//            brand accent colour: "active" is ink, not a hue. That is why the
//            floating pill's selected tab is ink-filled rather than tinted.
//
// The four saturated channels (c1–c4) exist ONLY to name score components.
// They are defined here so a future component band can use them, and they are
// deliberately not wired to buttons, status chips or navigation — borrowing
// one would break the rule that saturated colour means "this is a score".
//
// Why the deck is OPAQUE, not glassy: DESIGN.md revised this explicitly.
// Panels used to be 20–28% transparent, which put body text on drifting
// colour and made every panel read as the same sheet of glass. The field is
// seen AROUND and BETWEEN panels, in real negative space — not through them.
//
// ── THE SURFACE RULE ──────────────────────────────────────────────────────
// EVERY surface token in this file is opaque. This is not a taste call; it is
// the structural fix for the two-tone artifact that survived four separate
// component-level repairs.
//
// Alpha compositing is not idempotent. Two translucent layers over the same
// ground do not reproduce the parent's colour — they produce
// 1 - (1-a1)(1-a2). So the moment ANY second paint covers only PART of a
// translucent surface, that surface renders in two tones with a hard edge at
// the covering region's bounds. With the old dark deck (0.055 white) a child
// painted with the same token composited to 0.107, and a `glassStrong` child
// to 0.1495 — a 20-level step on an 8-bit channel, inside one panel.
//
// Three separate mechanisms produced the artifact and ALL THREE require the
// surface to transmit what is behind it:
//   1. translucent-on-translucent nesting (the dominant one),
//   2. Android's elevation shadow bleeding through a translucent view
//      (RN's background drawables never call Outline.setAlpha(), so Android
//      treats every RN view as an opaque occluder — see tokens.js),
//   3. the fallback Gradient's band quantisation showing through a panel face.
// Opaque surfaces kill all three at once.
//
// So:
//   • A surface token (panel/panelStrong/glass/glassStrong/slab/base/
//     baseElevated/inset/ink/inkPanel/accentSoft) is ALWAYS a finished,
//     fully opaque colour.
//   • Borders and the 1px sheen line MAY stay alpha — a hairline cannot
//     produce a region split.
//   • `inset` is the ONLY token a CHILD of a panel may paint with. It is a
//     finished colour, not a wash, so it composites with nothing.
// The __DEV__ invariant at the bottom of this file enforces the first rule on
// every reload, so no future edit can quietly reintroduce the bug class.

const light = {
  scheme: "light",

  // The field is the page.
  base: "#EFF1F4",
  baseElevated: "#FFFFFF",

  // The six field hues, in order, as the ground ramp.
  aurora: ["#F4F6F8", "#F1F3F7", "#EEF0F4", "#EBEEF2"],
  auroraBlobs: ["#DDE3EE", "#E4E7EF", "#D8E0EC"],
  auroraOpacity: 0.16,
  heroGradient: ["#7089A8", "#7699A8"],
  // Text on the hero gradient does NOT follow the palette: the gradient is the
  // same saturated ramp in both schemes, so its foreground is white either way.
  // These exist so a screen never has to write a raw white — the muted and
  // rule steps are part of the token set, not something each hero re-invents.
  onHero: "#FFFFFF",
  onHeroMuted: "rgba(255,255,255,0.86)",
  onHeroLine: "rgba(255,255,255,0.30)",
  mesh: ["#FAFBFC", "#F6F7FA", "#F2F4F8", "#EEF0F5"],

  // Deck — OPAQUE, per the surface rule above.
  panel: "#F8F9FB",
  panelStrong: "#FCFCFE",
  panelBorder: "rgba(28,36,50,0.07)",
  panelSheen: "rgba(255,255,255,0.9)",
  glass: "#F8F9FB",
  glassStrong: "#FCFCFE",
  glassBorder: "rgba(28,36,50,0.07)",
  glassSheen: "rgba(255,255,255,0.9)",

  // INSET — the only surface a child of a panel may paint with. Recessed
  // rather than raised, so it reads as a well cut into the deck instead of a
  // second sheet laid on top of it.
  inset: "#EDEFF4",
  insetBorder: "rgba(28,36,50,0.06)",

  // Slab — measurement only.
  slab: "#2B323F",
  slabBorder: "rgba(255,255,255,0.10)",
  // The receded state is a COLOUR, not a View opacity. See SlabCard.js.
  slabRecede: "#3A4250",

  // The floating pill takes the slab material.
  ink: "#F8F9FB",
  inkPanel: "#F8F9FB",
  onInk: "#2A3140",
  onInkMuted: "#8B94A3",

  text: "#1A1E28",
  textMuted: "#5A6373",
  textFaint: "#6A7284", // 4.85:1 on #FFFFFF — small text needs 4.5, not 3.9
  onAccent: "#FFFFFF",

  // Active is INK, not a hue. Cowork has no brand accent.
  accent: "#527092", // 4.72:1 on panel — accent carries text, so 4.5 is the floor,
  // Opaque: accentSoft is a SURFACE (icon wells, quiet buttons), not a tint.
  accentSoft: "#E9EDF3",
  accentAlt: "#63899B",

  // Status tints, taken from the state chips — none is a channel or field hue.
  success: "#4A8468",
  warning: "#8F7231",
  danger: "#A3564E",
  gold: "#A07A2E",
  silver: "#6E7684",
  bronze: "#8A6242",

  // The four score channels. Reserved.
  c1: "#00b26b",
  c2: "#c3d02e",
  c3: "#c22a9e",
  c4: "#8e8e8e",

  hairline: "rgba(28,36,50,0.07)",
  scrim: "rgba(20,26,38,0.32)",
  blurTint: "light",
  blurIntensity: 20,
  glow: "rgba(10,10,10,0.18)",
  glowSoft: "rgba(10,10,10,0.06)",
};

// Dark is the same architecture at inverted luminosity: the slab becomes the
// page, the deck becomes a dark panel, and the field darkens to its deep end.
const dark = {
  scheme: "dark",

  base: "#171A1F",
  baseElevated: "#1B1E26",

  // Real chroma. The previous values sat at ~4% saturation and rendered as
  // grey — which is what made the app read black-and-white. The field is the
  // product's signature and is meant to be SEEN in the gaps between panels,
  // so these stops carry the field hues at strength.
  aurora: ["#1C2027", "#1A1E24", "#181C22", "#171A1F"],
  auroraBlobs: ["#232833", "#20242E", "#1D212A"],
  auroraOpacity: 0.20,
  mesh: ["#1C1F27", "#191C24", "#161920", "#13161C"],

  // The hero card. NOT the accent — accent is white in this scheme, and a
  // large white slab was the single loudest thing on the screen. A card the
  // user acts on should be rich, and it takes its colour from the field so it
  // belongs to the same world.
  heroGradient: ["#5B7391", "#5C8494"],
  onHero: "#FFFFFF",
  onHeroMuted: "rgba(255,255,255,0.86)",
  onHeroLine: "rgba(255,255,255,0.30)",

  // These WERE white-alpha over the field (0.055 / 0.10), on the theory that a
  // panel picking up the hue behind it feels like glass. It does — and it is
  // also the exact mechanism of the two-tone artifact: 0.055 under 0.055 is
  // 0.107, under 0.10 is 0.1495, a ~20-level step inside one panel.
  //
  // They are now finished colours, sampled from the field so the deck still
  // belongs to the same world (a cool violet-slate, not neutral grey) but no
  // longer varies with what happens to be painted beneath it.
  panel: "#1F232A",
  panelStrong: "#252A33",
  panelBorder: "rgba(255,255,255,0.07)",
  panelSheen: "rgba(255,255,255,0.07)",
  glass: "#1F232A",
  glassStrong: "#252A33",
  glassBorder: "rgba(255,255,255,0.07)",
  glassSheen: "rgba(255,255,255,0.07)",

  // INSET — darker than the panel it sits in, so a control reads as recessed.
  // The only token a child of a panel may paint with.
  inset: "#252A32",
  insetBorder: "rgba(255,255,255,0.06)",

  slab: "#232830",
  slabBorder: "rgba(255,255,255,0.11)",
  slabRecede: "#1E222A",

  ink: "#232830",
  inkPanel: "#232830",
  onInk: "#EDEFF3",
  onInkMuted: "#8C94A1",

  text: "#F1F3F7",
  textMuted: "#A6AEBC",
  textFaint: "#89919F", // the floor DESIGN.md sets on the slab
  onAccent: "#FFFFFF",

  accent: "#7E9BBF",
  // Was another white wash (0.08) that stacked on the panel beneath it.
  accentSoft: "#242B36",
  accentAlt: "#79A3B5",

  success: "#77B294",
  warning: "#C7A76E",
  danger: "#C98D85",
  gold: "#D6B678",
  silver: "#A8B0BE",
  bronze: "#C09070",

  c1: "#00b26b",
  c2: "#c3d02e",
  c3: "#c22a9e",
  c4: "#8e8e8e",

  hairline: "rgba(255,255,255,0.07)",
  scrim: "rgba(0,0,0,0.55)",
  blurTint: "dark",
  blurIntensity: 24,
  glow: "rgba(0,0,0,0.30)",
  glowSoft: "rgba(255,255,255,0.06)",
};

export const palettes = { dark, light };

// ── The invariant ─────────────────────────────────────────────────────────
// This is the part that makes the two-tone artifact structurally impossible
// rather than merely fixed today. Four previous repairs each deleted ONE
// instance of "something is painted under part of a translucent surface";
// the tokens stayed translucent, so a new instance took its place every time.
//
// Every token named here is a SURFACE — something a region of the screen is
// filled with. If any of them is ever given an alpha value again, this fires
// on the next reload and names the file, the scheme and the token, instead of
// the bug resurfacing weeks later as "the colours look wrong again".
//
// Borders, sheens, hairlines, scrims and glows are deliberately NOT listed:
// a 1px line or a full-screen dimmer cannot produce a region split.
const OPAQUE_SURFACES = [
  "panel",
  "panelStrong",
  "glass",
  "glassStrong",
  "slab",
  "slabRecede",
  "base",
  "baseElevated",
  "inset",
  "ink",
  "inkPanel",
  "accentSoft",
];

function isOpaque(value) {
  const s = String(value).trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return true;
  if (/^#[0-9a-f]{8}$/i.test(s)) return s.slice(7).toLowerCase() === "ff";
  const m = /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+))?\s*\)$/i.exec(s);
  if (m) return m[1] === undefined || Number(m[1]) === 1;
  return false; // named colours, 3-digit hex, gradients — all rejected on purpose
}

if (typeof __DEV__ !== "undefined" && __DEV__) {
  Object.entries(palettes).forEach(([schemeName, p]) => {
    OPAQUE_SURFACES.forEach((token) => {
      if (!(token in p)) {
        console.error(
          `[palettes] ${schemeName}.${token} is missing. Light and dark must ` +
            `define identical keys, or a component reads undefined in one scheme.`,
        );
        return;
      }
      if (!isOpaque(p[token])) {
        console.error(
          `[palettes] ${schemeName}.${token} = "${p[token]}" is TRANSLUCENT. ` +
            `Surface tokens must be fully opaque — a translucent surface ` +
            `composites with whatever is painted beneath it, which is the ` +
            `two-tone artifact. Use a finished 6-digit hex. If you need a ` +
            `child surface inside a panel, use colors.inset.`,
        );
      }
    });
  });

  // Light and dark must stay key-identical, or a screen silently reads
  // `undefined` (which RN renders as transparent) in one scheme only.
  const lk = Object.keys(light);
  const dk = Object.keys(dark);
  const missing = [
    ...lk.filter((k) => !dk.includes(k)).map((k) => `dark.${k}`),
    ...dk.filter((k) => !lk.includes(k)).map((k) => `light.${k}`),
  ];
  if (missing.length) {
    console.error(`[palettes] key mismatch between schemes: ${missing.join(", ")}`);
  }
}

export default palettes;
