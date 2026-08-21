// src/theme/index.js
export { ms, SCALE, screen, radius, spacing, layout, elevation, glow, motion } from "./tokens";
// FONT is exported because React Native ignores `fontWeight` once `fontFamily`
// names a static face: a screen that needs a heavier cut of a scale entry must
// name the face, not set a weight. See the note at the top of typography.js.
export { type, FONT, FONT_FAMILY } from "./typography";
export { palettes } from "./palettes";
export { ThemeProvider, useTheme } from "./ThemeProvider";
