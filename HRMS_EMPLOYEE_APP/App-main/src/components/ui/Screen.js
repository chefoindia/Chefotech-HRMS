// src/components/ui/Screen.js
//
// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  HOW TO BUILD A SCREEN                                                ║
// ╚═══════════════════════════════════════════════════════════════════════╝
//
// Every page in this app is the same page. It has a ground, a safe area, a
// scroller, a gutter, a rhythm, a title, and room at the bottom for the
// floating nav pill. None of that is a decision a screen gets to make — it is
// the layout, and it lives here, in one file, so changing it here changes it
// everywhere.
//
//   import { Screen, Glass } from "../components/ui";
//
//   export default function LeaveScreen() {
//     const { data, refreshing, refresh } = useResource(...);
//     return (
//       <Screen title="Leave" subtitle="Request time off and track approvals."
//               refreshing={refreshing} onRefresh={refresh}>
//         <Glass label="Balance">…</Glass>
//         <Glass label="History">…</Glass>
//       </Screen>
//     );
//   }
//
// That is the whole thing. Children are panels; they stack with a consistent
// gap; the gutter, the safe-area edges and the nav-pill clearance are already
// correct.
//
// ── THE RULES ─────────────────────────────────────────────────────────────
//
// 1. A SCREEN NEVER SETS A backgroundColor. Not on the root, not on a View,
//    not on a card. Screens have no colour of their own — they are content on
//    a ground that `Screen` owns. If you find yourself reaching for a
//    background, you want a surface component, which is rule 2.
//
// 2. THERE ARE EXACTLY FOUR WAYS TO DRAW A SURFACE, and they are components,
//    not colours:
//       <Glass>      a panel on the ground. The default. Use `strong` for the
//                    one panel on the page that should sit forward.
//       <SlabCard>   the matte measurement card. Figures only.
//       <StatusTag>  a state chip.
//       <Figure>     a number with its label.
//    Controls (PrimaryAction, SecondaryAction, SegmentedToggle, …) draw their
//    own surfaces and already know the rules.
//
// 3. A CHILD OF A PANEL PAINTS `colors.inset` — never `colors.panel`,
//    `colors.glass`, `colors.glassStrong` or `colors.accentSoft`. Those are
//    PANEL tokens. Repainting a panel token inside a panel is the two-tone
//    artifact that took four attempts to kill: see the surface rule at the top
//    of theme/palettes.js. `inset` is defined as a finished colour precisely so
//    a child can sit on a panel without compositing with it. The __DEV__
//    invariant in palettes.js enforces that every surface token stays opaque.
//
// 4. SPACING BETWEEN PANELS IS `gap`, NOT MARGIN. Screen sets it. If one
//    screen needs a different rhythm, pass `gap={spacing.loose}` — do not add
//    marginBottom to a panel, because then the panel only works on that page.
//
// 5. NEVER RESERVE TAB-BAR SPACE BY HAND. There is no TAB_CLEARANCE in a
//    screen any more; `layout.tabClearance` is derived from the pill's own
//    geometry and Screen applies it. Pass `tabClearance={false}` for a page
//    that has no nav pill under it (a modal route, a stack detail page pushed
//    over the tabs).
//
// ── THE ESCAPE HATCHES ────────────────────────────────────────────────────
//
//   scroll={false}   the page manages its own scrolling (a FlatList, a
//                    calendar that must not bounce). You get ground + safe
//                    area + gutters and nothing else.
//   padded={false}   full-bleed content. Panels then own their own gutters.
//   footer={…}       pinned below the scroll area, above the nav pill —
//                    a commit bar that must not scroll away.
//   header={…}       replaces the title block entirely.
//
// If you need something that is not here, ADD IT HERE. A screen that
// hand-rolls its own frame is a screen that will drift, and this file exists
// because eleven of them already did.

import React, { useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  RefreshControl,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Aurora from "./Aurora";
import { useNavigation, useNavigationState } from "@react-navigation/native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { tap } from "../../lib/feedback";
import { useTheme, spacing, layout, type } from "../../theme";

export default function Screen({
  children,

  // ── The standard header ────────────────────────────────────────────────
  title,
  subtitle,
  /** Right-hand header slot — a ThemeToggle, a filter, an action. */
  right,
  /** Replaces the whole title block. Use when a page needs a real custom head. */
  header,
  /** Pass false to suppress the automatic back arrow on a pushed screen. */
  back,

  // ── Pull to refresh ────────────────────────────────────────────────────
  onRefresh,
  refreshing = false,

  // ── Layout ─────────────────────────────────────────────────────────────
  /** false → you own the scrolling (FlatList, SectionList, fixed page). */
  scroll = true,
  /** false → full-bleed; panels own their gutters. */
  padded = true,
  /** Rhythm between direct children. */
  gap = spacing.base,
  /** false → this route has no floating nav pill beneath it. */
  tabClearance = true,
  /** Safe-area edges. Bottom is off by default: the pill occupies it. */
  edges = ["top"],

  // ── Pinned below the scroller, above the pill ──────────────────────────
  footer,

  // ── Passthrough ────────────────────────────────────────────────────────
  style,
  contentContainerStyle,
  scrollProps,
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  // Back is decided here, not per screen.
  //
  // canGoBack() alone is WRONG for a tab root: the tab navigator is itself
  // nested in a stack, so canGoBack() is true on Work and Standings even
  // though there is nothing to go back to — you reached them from the tab bar.
  // What actually matters is this navigator's own index: index > 0 means the
  // screen was PUSHED, which is exactly the Work-hub sub-pages and nothing
  // else. A screen can still opt out with back={false}.
  const navigation = useNavigation();
  const pushed = useNavigationState((st) => (st?.index ?? 0) > 0);
  const showBack = back !== false && pushed && navigation?.canGoBack?.();

  const hasHead = Boolean(header || title || subtitle || right || showBack);

  const head = hasHead ? (
    header ?? (
      <View style={st.head}>
        <View style={st.headText}>
          {title ? (
            // Full-strength ink on the field. A page title is the one piece of
            // text allowed to sit directly on the ground with no panel.
            <Text style={s.title} numberOfLines={2}>
              {title}
            </Text>
          ) : null}
          {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
        </View>
        {right ? <View style={st.headRight}>{right}</View> : null}
        {/* Back sits on the RIGHT, with the other header controls. On the left
            it indented the title and every page's heading started at a
            different x depending on whether it happened to be pushed —
            the title block must not move. */}
        {showBack ? (
          <Pressable
            onPress={() => {
              tap();
              navigation.goBack();
            }}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={({ pressed }) => [s.back, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
    )
  ) : null;

  // The gutter and the rhythm are one object so a screen cannot get one and
  // miss the other.
  const contentStyle = [
    padded && { paddingHorizontal: layout.gutter },
    { paddingTop: spacing.base, gap },
    contentContainerStyle,
  ];

  const body = scroll ? (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={contentStyle}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            // The spinner has to be legible on both grounds, and the default
            // is a fixed grey that vanishes in dark mode.
            tintColor={colors.text}
            colors={[colors.accent]}
            progressBackgroundColor={colors.panel}
          />
        ) : undefined
      }
      {...scrollProps}
    >
      {head}
      {children}

      {/* Clearance for the floating pill. A spacer rather than paddingBottom
          because RefreshControl and contentInset interact badly with bottom
          padding on iOS, and a View is the same pixels with none of that. */}
      {tabClearance ? <View style={{ height: layout.tabClearance }} /> : null}
    </ScrollView>
  ) : (
    <View style={[st.fill, contentStyle]}>
      {head}
      {children}
    </View>
  );

  return (
    <Aurora>
      <SafeAreaView style={[st.fill, style]} edges={edges}>
        {body}
        {footer ? (
          <View
            style={[
              st.footer,
              padded && { paddingHorizontal: layout.gutter },
              tabClearance && { paddingBottom: layout.tabClearance },
            ]}
          >
            {footer}
          </View>
        ) : null}
      </SafeAreaView>
    </Aurora>
  );
}

/**
 * A titled group inside a Screen, for content that is NOT a panel — a row of
 * SlabCards, a metric strip. Gives the section head the same type and rhythm
 * a <Glass label> gets, so a bare group never looks like a different system.
 */
Screen.Section = function Section({ title, right, children, style, gap = spacing.snug }) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[{ gap }, style]}>
      {title || right ? (
        <View style={st.sectionHead}>
          {title ? <Text style={s.sectionTitle}>{title}</Text> : null}
          <View style={st.flex} />
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
};

// Colour-free geometry. Anything that varies by scheme goes in makeStyles, so
// a stale StyleSheet can never pin a light-mode colour into dark mode.
const st = StyleSheet.create({
  fill: { flex: 1 },
  head: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.snug,
  },
  headText: { flex: 1, gap: spacing.hair },
  headRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.tight,
    // Optically aligns a 36dp control with the title's cap height rather than
    // its line box.
    paddingTop: Platform.OS === "ios" ? 2 : 0,
  },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing.tight },
  flex: { flex: 1 },
  footer: { paddingTop: spacing.snug },
});

const makeStyles = (colors) =>
  StyleSheet.create({
    back: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.inset,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
    },
    title: { ...type.display, color: colors.text },
    subtitle: { ...type.body, color: colors.textMuted },
    sectionTitle: { ...type.title, color: colors.text },
  });
