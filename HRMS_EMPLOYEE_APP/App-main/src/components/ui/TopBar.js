// src/components/ui/TopBar.js
//
// Glass bar docked to the top, with the theme toggle living in it — the
// toggle belongs where it is always reachable, not buried in Settings.

import React from "react";
import { View, Text, Image, StyleSheet, Pressable } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tap } from "../../lib/feedback";
import { Platform } from "react-native";
import { useTheme, radius, spacing, layout, type } from "../../theme";

const LOGO = require("../../../assets/grav-logo.png");

export function ThemeToggle({ style }) {
  const { colors, isDark, toggle } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: isDark }}
      accessibilityLabel={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onPress={() => {
        tap();
        toggle();
      }}
      style={({ pressed }) => [
        styles.iconBtn,
        // `inset` — a 36dp disc sitting on top of PART of the bar's own
        // full-bleed fill is the same partial overlap as any other nested
        // surface, just smaller.
        { backgroundColor: colors.inset, borderColor: colors.insetBorder },
        pressed && { opacity: 0.6 },
        style,
      ]}
    >
      <Ionicons
        name={isDark ? "sunny-outline" : "moon-outline"}
        size={18}
        color={colors.text}
      />
    </Pressable>
  );
}

export default function TopBar({ title, right, showMark = true, showThemeToggle = true }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: colors.glass,
            borderBottomWidth: layout.hairlineWidth,
            borderBottomColor: colors.glassBorder,
          },
        ]}
      />
      <View style={styles.inner}>
        {showMark ? <Image source={LOGO} style={styles.mark} resizeMode="contain" /> : null}
        {title ? (
          <Text style={[type.title, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {right}
        {showThemeToggle ? <ThemeToggle /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderRadius: radius.shell, overflow: "hidden" },
  inner: {
    height: layout.topBarHeight,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.base,
    gap: spacing.snug,
  },
  mark: { width: 64, height: 22 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: layout.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
