// src/components/ui/Controls.js
//
// Interactive controls. Core RN only — no reanimated, no native modules.
//
// Every control responds physically: a spring scale on press plus a haptic
// tick. That pairing is most of what "playful" means on a phone — the
// interface acknowledging a touch in under 100ms — and it costs far less
// than animation anywhere else.
//
// Animated.spring with useNativeDriver:true runs the scale on the UI thread,
// so a press stays smooth even while a list is rendering or a fetch resolves.
// Reanimated would buy worklet-level control this file has no use for.

import React, { useCallback, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Animated,
} from "react-native";
import Gradient from "./Gradient";
import { tap } from "../../lib/feedback";
import { useTheme, radius, spacing, layout, type, glow } from "../../theme";

/** Shared press-scale behaviour. */
function usePressScale(to = 0.96) {
  const scale = useRef(new Animated.Value(1)).current;
  const spring = useCallback(
    (v) =>
      Animated.spring(scale, {
        toValue: v,
        useNativeDriver: true,
        speed: 40,
        bounciness: 6,
      }).start(),
    [scale],
  );
  return {
    style: { transform: [{ scale }] },
    onPressIn: () => spring(to),
    onPressOut: () => spring(1),
  };
}

/** The primary commit control — gradient fill with a neon glow. */
export function PrimaryAction({ label, onPress, disabled, loading, style, icon }) {
  const { colors } = useTheme();
  const press = usePressScale();

  return (
    <Animated.View style={[press.style, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled || !!loading }}
        disabled={disabled || loading}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => {
          tap("medium");
          onPress?.();
        }}
        style={[
          styles.primaryWrap,
          glow(colors.heroGradient[0], 0.4),
          (disabled || loading) && styles.disabled,
        ]}
      >
        <Gradient
          colors={colors.heroGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.primaryFill}
        >
          <View style={styles.primaryInner}>
            {loading ? (
              <ActivityIndicator color={colors.onHero} />
            ) : (
              <>
                {icon}
                <Text style={[type.title, { color: colors.onHero }]}>{label}</Text>
              </>
            )}
          </View>
        </Gradient>
      </Pressable>
    </Animated.View>
  );
}

/** A quieter control on glass. */
export function SecondaryAction({ label, onPress, disabled, style, icon }) {
  const { colors } = useTheme();
  const press = usePressScale(0.97);

  return (
    <Animated.View style={[press.style, style]}>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => {
          tap();
          onPress?.();
        }}
        style={[
          styles.secondary,
          // `inset`, not `glassStrong`: this control almost always sits ON a
          // panel, and a child must never repaint its parent's surface token.
          { backgroundColor: colors.inset, borderColor: colors.insetBorder },
          disabled && styles.disabled,
        ]}
      >
        {icon}
        <Text style={[type.title, { color: colors.text }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/** Low-weight inline text action inside a row. */
export function InlineAction({ label, onPress, tone, disabled, style }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.inline,
        pressed && { opacity: 0.55 },
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[type.caption, { color: tone ? colors[tone] || tone : colors.accent }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Segmented switch. A radiogroup — the segments are named alternatives.
 *
 * The track paints `inset`. It used to paint `colors.glass` — the IDENTICAL
 * token as the panel it is dropped into — so the defect travelled with the
 * component to every screen that used it, and RegularizeScreen stacking two of
 * these inside one <Glass> produced two full-width lighter bars separated by a
 * strip of bare panel. That was the most literal rendition of the reported bug.
 */
export function SegmentedToggle({ options, value, onChange, style }) {
  const { colors } = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      style={[
        styles.track,
        { backgroundColor: colors.inset, borderColor: colors.insetBorder },
        style,
      ]}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={String(opt.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
            onPress={() => {
              tap();
              onChange(opt.value);
            }}
            style={[styles.segment, active && { backgroundColor: colors.accent }]}
          >
            <Text
              numberOfLines={1}
              style={[
                type.caption,
                styles.segmentText,
                { color: active ? colors.onAccent : colors.textMuted },
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Kept as an alias: earlier screens import LensToggle.
export const LensToggle = SegmentedToggle;

const styles = StyleSheet.create({
  primaryWrap: { borderRadius: radius.control, overflow: "hidden" },
  primaryFill: { borderRadius: radius.control },
  primaryInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.tight,
    paddingVertical: 15,
    paddingHorizontal: spacing.loose,
  },
  secondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.tight,
    borderRadius: radius.control,
    borderWidth: layout.hairlineWidth,
    paddingVertical: 13,
    paddingHorizontal: spacing.loose,
  },
  inline: { paddingVertical: spacing.hair, paddingHorizontal: spacing.tight },
  disabled: { opacity: 0.4 },
  track: {
    flexDirection: "row",
    borderRadius: radius.control,
    borderWidth: layout.hairlineWidth,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: radius.control - 3,
  },
  segmentText: { fontWeight: "600" },
});
