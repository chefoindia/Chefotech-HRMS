// src/components/ui/Glass.js
//
// The glass pane. No native modules — core RN only.
//
// There is no real backdrop blur here, because expo-blur is a native module.
// What actually makes a surface read as glass at panel size is not the blur:
// it is the translucent tint, the hairline border, and the lit top edge. The
// blur is the smallest of the four contributions and the only one that costs
// a native dependency and per-frame compositing.
//
// The tint is the load-bearing layer. Without it, text sits directly on the
// drifting aurora and its contrast changes as colour moves behind it —
// unreadable exactly when a bright wash passes through. The tint is what
// makes translucency safe.
//
// If a real blur is wanted later, swap the tint View for a BlurView in this
// one file; nothing else needs to change.

import React, { createContext, useContext } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { NativeBlurView } from "./native";
import { useTheme, radius, spacing, layout, elevation, type } from "../../theme";

// Whether the panel already pads its own contents. Rows read this so they can
// supply their own horizontal inset when the panel does not — without it, rows
// in an unpadded list panel sit flush against the border, which is the
// "content touching the edge" defect. Screens used to hand-pass a padding
// style to every row to compensate; one missed row and that panel looked
// broken. Owning it here means no screen can get it wrong.
const PaddedContext = createContext(true);

export default function Glass({
  children,
  label,
  right,
  style,
  padded = true,
  strong = false,
}) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.wrap,
        {
          borderRadius: radius.panel,
          backgroundColor: strong ? colors.glassStrong : colors.glass,
          borderWidth: layout.hairlineWidth,
          borderColor: colors.glassBorder,
        },
        elevation.panel,
        style,
      ]}
    >
      {/* Real backdrop blur when the build has it. The tint below stays
          either way: it is what keeps text contrast certifiable while the
          mesh drifts underneath, and blur alone cannot do that. */}
      {NativeBlurView ? (
        <NativeBlurView
          intensity={colors.blurIntensity}
          tint={colors.blurTint}
          style={[StyleSheet.absoluteFill, { borderRadius: radius.panel }]}
          pointerEvents="none"
        />
      ) : null}

      <View
        pointerEvents="none"
        style={[
          styles.sheen,
          {
            backgroundColor: colors.glassSheen,
            borderTopLeftRadius: radius.panel,
            borderTopRightRadius: radius.panel,
          },
        ]}
      />

      <PaddedContext.Provider value={padded}>
        <View style={padded && styles.padded}>
        {label || right ? (
          <View style={[styles.header, !padded && styles.headerInset]}>
            {label ? (
              <Text style={[type.title, { color: colors.text }]}>{label}</Text>
            ) : null}
            <View style={{ flex: 1 }} />
            {right}
          </View>
        ) : null}
          {children}
        </View>
      </PaddedContext.Provider>
    </View>
  );
}

Glass.Row = function Row({ children, onPress, style, first }) {
  const { colors } = useTheme();
  const parentPadded = useContext(PaddedContext);
  const base = [
    styles.row,
    // Only when the panel is not padding for us. Applying it unconditionally
    // would double the inset inside an ordinary padded panel.
    !parentPadded && styles.rowInset,
    !first && { borderTopWidth: layout.hairlineWidth, borderTopColor: colors.hairline },
    style,
  ];

  // A function `style` is a Pressable affordance only — passing one to a
  // plain View throws, so static rows must not take that branch.
  if (!onPress) return <View style={base}>{children}</View>;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [...base, pressed && { opacity: 0.55 }]}
    >
      {children}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  wrap: { overflow: "hidden" },
  padded: { paddingVertical: spacing.base, paddingHorizontal: spacing.base },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.snug,
    gap: spacing.tight,
  },
  // A label on an UNPADDED panel (a list) has no container padding to sit in,
  // so it renders flush against the border. It has to bring its own inset —
  // this is the "section title stuck to the edge" defect, and owning it here
  // means it cannot recur on a new list panel.
  headerInset: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.snug,
  },
  sheen: { position: "absolute", top: 0, left: 0, right: 0, height: 1 },
  rowInset: { paddingHorizontal: spacing.base },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.snug,
    gap: spacing.snug,
  },
});
