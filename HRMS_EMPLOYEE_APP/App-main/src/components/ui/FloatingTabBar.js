// src/components/ui/FloatingTabBar.js
//
// The signature chrome: a graphite pill that floats clear of the screen edge.
//
// Why a custom bar rather than styling the default one — the default tab bar
// is a full-bleed strip welded to the bottom of the display. Insetting it is
// not a style tweak; the bar has to stop being a strip. This renders the whole
// thing, so the pill can sit on the field with the mesh visible around and
// under it, which is the entire point of a floating nav.
//
// The active tab does not just change colour. It grows a filled lozenge that
// carries the label, and inactive tabs drop their label entirely — so the bar
// stays narrow enough to float at five tabs, and the current location is
// legible from the shape alone, not only from a tint. That is what makes it
// readable one-handed at arm's length.

import React, { useEffect, useRef } from "react";
import { View, Text, Pressable, StyleSheet, Animated, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { tap } from "../../lib/feedback";
import { useBadges } from "../../lib/badges";
import { useTheme, radius, spacing, layout, type, motion, ms } from "../../theme";

const LABELS = { Standings: "Ranks" };

function Tab({ route, label, focused, icons, onPress, colors, dot }) {
  // PERFORMANCE — this used to animate `width` and `paddingHorizontal` with
  // useNativeDriver:false. Layout properties cannot run on the native driver,
  // so every tab switch ran a spring through the JS thread for five tabs at
  // once, while the destination screen was also mounting and fetching. That
  // is what made switching tabs feel like it stuttered.
  //
  // Only opacity and scale animate now, both native-driver, and the label
  // mounts/unmounts rather than growing from zero width. No layout animation
  // means no JS-thread work on the one interaction used most.
  const fade = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: focused ? 1 : 0,
      duration: motion.fast,
      useNativeDriver: true,
    }).start();
  }, [focused, fade]);

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      onPress={() => {
        tap();
        onPress();
      }}
      style={styles.tapTarget}
    >
      <View
        style={[
          styles.tab,
          focused && {
            backgroundColor: colors.accent,
            // Tinted from the accent rather than stroked in the pill's own
            // foreground: a contrasting ring made the chip read as two
            // objects. This reads as one raised key.
            borderColor: colors.accent,
          },
        ]}
      >
        <View>
          <Ionicons
            name={focused ? icons.active : icons.idle}
            size={20}
            color={focused ? colors.onAccent : colors.onInkMuted}
          />
          {/* A dot, not a count — see lib/badges.js. Ringed in the pill's own
              colour so it reads as sitting ON the icon rather than beside it,
              at any tab position. */}
          {dot ? (
            <View
              style={[
                styles.dot,
                { backgroundColor: colors.danger, borderColor: colors.ink },
              ]}
            />
          ) : null}
        </View>
        {focused ? (
          <Animated.Text
            numberOfLines={1}
            style={[type.caption, styles.label, { color: colors.onAccent, opacity: fade }]}
          >
            {label}
          </Animated.Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function FloatingTabBar({ state, descriptors, navigation, icons }) {
  const { colors } = useTheme();
  const { badges } = useBadges();
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.dock,
        {
          paddingBottom: Math.max(insets.bottom, spacing.snug) + layout.tabBarLift,
          paddingHorizontal: layout.tabBarInset,
        },
      ]}
    >
      <View
        style={[
          styles.pill,
          {
            backgroundColor: colors.ink,
            borderColor: colors.panelBorder,
            // A real offset, not a halo — the pill is lifted off the field.
            // Elevation requires an OPAQUE background on Android: RN's
            // getOutline never calls setAlpha, so a translucent elevated view
            // gets a shadow it cannot hide. colors.ink is opaque by contract
            // (see the surface rule in palettes.js), so this is safe.
            shadowColor: "#000",
            ...Platform.select({
              ios: { shadowOffset: { width: 0, height: 10 }, shadowRadius: 24, shadowOpacity: 0.18 },
              android: { elevation: 12 },
              default: { boxShadow: "0 10px 24px rgba(0,0,0,0.18)" },
            }),
          },
        ]}
      >
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };
          return (
            <Tab
              key={route.key}
              route={route.name}
              label={LABELS[route.name] || route.name}
              focused={focused}
              icons={icons[route.name]}
              onPress={onPress}
              colors={colors}
              dot={Number(badges?.[route.name] || 0) > 0}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: ms(27), // half the pill's own height
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: ms(7),
    paddingHorizontal: ms(7),
  },
  tapTarget: {
    // The visible lozenge is smaller than the touch area; 44pt minimum is not
    // negotiable on a control this is used dozens of times a day.
    minHeight: 44, // never scaled: 44pt is an accessibility floor, not a look
    justifyContent: "center",
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: ms(40),
    paddingHorizontal: ms(13),
    // Transparent border reserved on every tab: adding a border only to the
    // active one would shift the whole row by a pixel on each switch.
    borderWidth: 1,
    borderColor: "transparent",
    // Exactly half the height. `radius.pill` (9999) is far larger than half
    // this box and Android clamps oversized radii inconsistently, which is
    // why the active chip rendered as a square.
    borderRadius: ms(20),
  },
  label: { fontWeight: "700", letterSpacing: -0.1 },
  dot: {
    position: "absolute",
    top: -2,
    right: -3,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    // The ring is what keeps it legible over both the icon and the pill.
    borderWidth: 1.5,
  },
});
