import { useFonts } from "expo-font";

// Imported per weight, not from the package root. The root index re-exports
// every face the family ships — nine weights plus nine italics — and each one
// is a top-level `require` of a .ttf, so Metro bundles all eighteen the moment
// anything touches that module. It did: the first Android bundle carried 18
// Inter files for the 4 the app renders. These subpaths pull one face each.
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";

/**
 * Inter, the same typeface the web portal sets.
 *
 * The theme's own note says the point of sharing the brand ramp and radii is
 * that "an employee who uses the portal on a laptop and the app on a phone is
 * looking at one product rather than two that share a logo". Type was the one
 * token that never made it across: the app shipped with no custom font at all,
 * so the same person read Inter in the browser and San Francisco or Roboto in
 * the app.
 *
 * ── Why weights are families here, not `fontWeight` ─────────────────────────
 *
 * React Native does not synthesise weights from a custom font on Android. Each
 * weight is a separate file with its own family name, and `fontWeight: "600"`
 * beside `fontFamily: "Inter_400Regular"` renders regular — silently, and only
 * on Android, which is exactly the kind of difference that survives review on
 * an iPhone. So the weight picks the family, and `fontWeight` is left off the
 * text styles entirely.
 *
 * Only the four weights the app actually uses are bundled. The package ships
 * nine plus italics; embedding all of them would add megabytes to the download
 * for glyphs nothing renders.
 */

export type FontWeight = "400" | "500" | "600" | "700";

const FAMILIES: Record<FontWeight, string> = {
  "400": "Inter_400Regular",
  "500": "Inter_500Medium",
  "600": "Inter_600SemiBold",
  "700": "Inter_700Bold",
};

let loaded = false;

/**
 * Load the brand typeface.
 *
 * Returns once the fonts are ready *or* have failed. A failure is not worth
 * blocking a launch over — an employee at a factory gate needs to check in,
 * and the system font is a perfectly legible fallback — so this reports itself
 * finished either way and `font()` simply stops naming a family.
 */
export function useBrandFonts() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  loaded = fontsLoaded && !fontError;
  return fontsLoaded || Boolean(fontError);
}

/**
 * The family name for a weight, or undefined before the fonts are ready.
 *
 * Undefined is deliberate: it leaves `fontFamily` unset, which is the system
 * font. Naming a family that has not loaded gives a blank text run on Android.
 */
export function font(weight: FontWeight = "400"): string | undefined {
  return loaded ? FAMILIES[weight] : undefined;
}

/**
 * A complete text style for a weight — the usual way to reach this module.
 *
 * When the family is available it also pins `fontWeight` back to normal. The
 * weight is already baked into the file, and leaving a numeric weight beside
 * it asks the platform to embolden an already-bold face: on Android that is a
 * smeared synthetic bold over Inter SemiBold, which looks like a rendering
 * fault rather than a heading.
 */
export function fontStyle(weight: FontWeight = "400") {
  const family = font(weight);
  // Without the loaded typeface, fall back to asking the platform for the
  // weight, which is the behaviour the app had before Inter was added.
  return family
    ? ({ fontFamily: family, fontWeight: "normal" } as const)
    : ({ fontWeight: weight } as const);
}
