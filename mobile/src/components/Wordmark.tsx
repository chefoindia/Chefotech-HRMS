import { View, Text, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { BRAND } from "../brand";
import { useColors } from "../theme/ThemeProvider";
import { spacing } from "../theme";
import { fontStyle } from "../theme/fonts";

/**
 * The product's mark and name, together.
 *
 * The app previously never told anyone what it was. The splash is image-only,
 * the four intro slides carry no name, and the login screen showed the
 * launcher icon above the words "Welcome back" — so someone handed an APK by
 * their employer could get all the way to a password field without once
 * reading which product they were signing in to. The web login has always
 * shown a text lockup here; this is its counterpart.
 *
 * Split the way the web splits it: the company in full weight, the product
 * suffix lighter beside it. The suffix is whatever `BRAND.name` has left after
 * the company, rather than the literal "HRMS", so a product rename in app.json
 * carries through instead of leaving a stale word behind.
 */
export function Wordmark({
  size = "md",
  showMark = true,
  style,
}: {
  size?: "sm" | "md" | "lg";
  showMark?: boolean;
  style?: ViewStyle;
}) {
  const colors = useColors();

  const scale = { sm: { mark: 24, text: 15 }, md: { mark: 32, text: 17 }, lg: { mark: 44, text: 21 } }[size];
  const suffix = BRAND.name.startsWith(BRAND.company)
    ? BRAND.name.slice(BRAND.company.length).trim()
    : "";

  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: spacing.sm }, style]}>
      {showMark && (
        <Image
          source={require("../../assets/logo.png")}
          style={{ width: scale.mark, height: scale.mark }}
          contentFit="contain"
          transition={200}
          // The name sits right beside it, so announcing the image as well
          // would have a screen reader read the product twice.
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      )}

      <Text
        accessibilityRole="header"
        style={[{ fontSize: scale.text, letterSpacing: -0.3, color: colors.text }, fontStyle("600")]}
      >
        {suffix ? BRAND.company : BRAND.name}
        {suffix ? (
          <Text style={[{ color: colors.textMuted }, fontStyle("400")]}> {suffix}</Text>
        ) : null}
      </Text>
    </View>
  );
}
