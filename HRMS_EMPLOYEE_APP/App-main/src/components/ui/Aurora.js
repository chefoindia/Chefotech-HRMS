// src/components/ui/Aurora.js
//
// The ground. ONE opaque gradient. Nothing is layered over it.
//
// This is the fourth version and the lesson is finally applied properly:
// every visual artifact reported on this screen — hard stripes, ruled lines,
// two-tone regions — came from compositing translucent surfaces on top of
// each other. Three full-bleed tinted layers meant that wherever two of them
// were dense, the result read as a distinctly different colour block, which
// is the "lighter and darker colour in one section" that kept coming back.
//
// So there is no stacking any more. A single multi-stop OPAQUE ramp cannot
// produce a compositing artifact, because there is nothing to composite with.
// The warmth and depth come from the stops themselves, not from layers.
//
// It also removes the animation. A drifting background was worth its cost
// only while it looked good; a static, correct ground beats a moving, broken
// one, and it gives the JS thread back to the screens.

import React from "react";
import { View, StyleSheet } from "react-native";
import Gradient from "./Gradient";
import { useTheme } from "../../theme";

export default function Aurora({ children, style }) {
  const { colors } = useTheme();

  return (
    <View style={[styles.root, { backgroundColor: colors.base }, style]}>
      <Gradient
        colors={colors.aurora}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
});
