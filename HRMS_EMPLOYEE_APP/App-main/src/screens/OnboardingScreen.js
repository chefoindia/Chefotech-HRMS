// src/screens/OnboardingScreen.js
//
// The "Get Started" intro. Shown once, to a first-time user only.
//
// The "once" is the important part and it is deliberately keyed on a flag
// that is written when the user finishes the intro — NOT on whether a session
// exists. Keying it on login would re-show the whole intro to anyone who
// signed out, which is exactly the behaviour that makes onboarding feel like
// an obstacle instead of a welcome.

import React, { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import Gradient from "../components/ui/Gradient";
import { Aurora, PrimaryAction, InlineAction, ThemeToggle } from "../components/ui";
import { useTheme, radius, spacing, type, glow } from "../theme";

export const ONBOARDING_KEY = "grav.onboarding.completed";

const SLIDES = [
  {
    icon: "finger-print",
    title: "Your workday,\nin one place",
    body: "Attendance, leave, overtime, payslips and tasks — without chasing anyone for an update.",
  },
  {
    icon: "stats-chart",
    title: "See how\nyou're doing",
    body: "Your attendance rate, leave balance and SOP record, updated as your month happens.",
  },
  {
    icon: "trophy",
    title: "Good work,\nrecognised",
    body: "Daily standings across your team, so consistent effort actually shows up somewhere.",
  },
];

export default function OnboardingScreen({ onDone }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef(null);

  const onScroll = useCallback(
    (e) => {
      const i = Math.round(e.nativeEvent.contentOffset.x / width);
      if (i !== index) setIndex(i);
    },
    [index, width],
  );

  const next = useCallback(() => {
    if (index < SLIDES.length - 1) {
      scrollRef.current?.scrollTo({ x: (index + 1) * width, animated: true });
    } else {
      onDone?.();
    }
  }, [index, width, onDone]);

  const last = index === SLIDES.length - 1;

  return (
    <Aurora>
      <SafeAreaView style={styles.safe}>
        <View style={styles.topRow}>
          <ThemeToggle />
          <View style={{ flex: 1 }} />
          {/* Skip must stay available on every slide — a user who already
              knows the product should never have to page through three
              screens to reach a login form. */}
          <InlineAction label="Skip" onPress={onDone} tone="textMuted" />
        </View>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScroll}
          style={{ flex: 1 }}
        >
          {SLIDES.map((s, i) => (
            <View key={i} style={[styles.slide, { width }]}>
              <View style={[
                  styles.iconWrap,
                  { borderColor: colors.glassBorder, backgroundColor: colors.glass },
                  glow(colors.accent, 0.35),
                ]}
              >
                <Gradient
                  colors={[colors.accent, colors.accentAlt]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.iconFill}
                >
                  <Ionicons name={s.icon} size={34} color={colors.onAccent} />
                </Gradient>
              </View>

              <Text style={[type.display, styles.title, { color: colors.text }]}
              >
                {s.title}
              </Text>
              <Text style={[type.body, styles.body, { color: colors.textMuted }]}
              >
                {s.body}
              </Text>
            </View>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.dots}>
            {SLIDES.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor: i === index ? colors.accent : colors.glassBorder,
                    width: i === index ? 22 : 7,
                  },
                ]}
              />
            ))}
          </View>

          <PrimaryAction
            label={last ? "Get started" : "Next"}
            onPress={next}
            icon={
              <Ionicons
                name={last ? "arrow-forward" : "chevron-forward"}
                size={18}
                color={colors.onAccent}
              />
            }
          />
        </View>
      </SafeAreaView>
    </Aurora>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.base,
    paddingTop: spacing.tight,
    gap: spacing.tight,
  },
  slide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.section,
    gap: spacing.base,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.base,
    overflow: "hidden",
  },
  iconFill: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { textAlign: "center" },
  body: { textAlign: "center", maxWidth: 320, lineHeight: 22 },
  footer: {
    paddingHorizontal: spacing.loose,
    paddingBottom: spacing.loose,
    gap: spacing.loose,
  },
  dots: { flexDirection: "row", justifyContent: "center", gap: spacing.tight },
  dot: { height: 7, borderRadius: radius.pill },
});
