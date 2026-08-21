// src/components/ui/native.js
//
// Progressive enhancement for the two native effects the design wants:
// real backdrop blur and real gradients.
//
// The problem this solves: `require("expo-blur")` SUCCEEDS on a build that
// lacks the native module — the JS shim is always in node_modules — and only
// throws when the view is actually rendered. A try/catch around the require
// therefore proves nothing. `requireOptionalNativeModule` asks the native
// registry directly and returns null when the module is genuinely absent,
// which is the only reliable probe. (This exact mistake is what crashed the
// app on 'ExpoLocalAuthentication'.)
//
// The app therefore runs on the CURRENT build with hand-drawn gradients and
// flat tints, and the moment a build ships containing expo-blur and
// expo-linear-gradient the same code upgrades itself, with no further edit.
//
// NOTE: the requires below MUST be static string literals. Metro resolves the
// module graph at build time, so `require(someVariable)` is a hard bundling
// error ("Invalid call at line N") rather than a runtime fallback.

import { requireOptionalNativeModule } from "expo-modules-core";

function load(nativeName, loader) {
  try {
    if (!requireOptionalNativeModule(nativeName)) return null;
    return loader() || null;
  } catch {
    return null;
  }
}

/** expo-linear-gradient's LinearGradient, or null on a build without it. */
export const NativeLinearGradient = load("ExpoLinearGradient", () => {
  // eslint-disable-next-line global-require
  return require("expo-linear-gradient").LinearGradient;
});

/** expo-blur's BlurView, or null on a build without it. */
export const NativeBlurView = load("ExpoBlurView", () => {
  // eslint-disable-next-line global-require
  return require("expo-blur").BlurView;
});

export const hasNativeGradient = !!NativeLinearGradient;
export const hasNativeBlur = !!NativeBlurView;
