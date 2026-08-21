// src/screens/DashboardScreen.js
//
// Home, rebuilt in the committed world (direction contract: src/theme/palettes.js).
//
// The composition deliberately refuses the category default this screen used
// to be — a grid of equal icon+label+number tiles, which is what every HR app
// ships. One hierarchy instead:
//
//   1. Greeting sits directly on the mesh at display scale. No card.
//   2. ONE heavy object: the gradient status card. The only saturated surface
//      on the screen, and it carries what you came to check.
//   3. Below it, quiet near-white panels that VARY in density — a figure row,
//      then a list. Never four identical tiles.
//
// The old version gave each stat tile a 3px coloured left border. A coloured
// rule wider than a hairline is decoration standing in for hierarchy, so the
// figures carry their own weight now.
//
// LAYOUT: this page is a <Screen> (see the HOW TO BUILD A SCREEN block at the
// top of components/ui/Screen.js). Screen owns the ground, the safe area, the
// scroller, the gutter, the pull-to-refresh spinner, the rhythm between panels
// and the nav-pill clearance — none of which appear in this file.
//
// The greeting is not `title`/`subtitle`: it is three ranks of text (greeting,
// name, role) beside a tappable avatar, so it goes through Screen's `header`
// escape hatch, which replaces the standard title block wholesale. It is still
// laid out BY Screen, at Screen's gutter and rhythm — which is why there is no
// marginBottom on it. Spacing between top-level children is Screen's `gap`.

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAuth } from "../context/AuthContext";
import { getApiUrl } from "../lib/api";
import API_CONFIG from "../lib/api";
import { Screen, Glass, Gradient, Avatar, Figure } from "../components/ui";
import { tap } from "../lib/feedback";
import { useTheme, radius, spacing, layout, type, glow } from "../theme";

const PRESENT = ["P", "P*", "P~", "MP", "WFH"];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const ACTIONS = [
  { key: "leave", label: "Apply for leave", icon: "add-circle-outline", route: "Leave" },
  { key: "attendance", label: "Attendance history", icon: "finger-print-outline", route: "Attendance" },
  { key: "overtime", label: "Overtime", icon: "time-outline", route: "Overtime" },
  { key: "regularize", label: "Regularize a day", icon: "build-outline", route: "Regularize" },
];

export default function DashboardScreen({ navigation }) {
  const { user, apiFetch } = useAuth();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [att, setAtt] = useState(null);
  const [leaveApps, setLeaveApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, l] = await Promise.allSettled([
        apiFetch(getApiUrl(API_CONFIG.endpoints.attendance.today)),
        apiFetch(getApiUrl(API_CONFIG.endpoints.leave.list)),
      ]);
      if (a.status === "fulfilled" && a.value?.success) setAtt(a.value.data);
      if (l.status === "fulfilled" && l.value?.success) setLeaveApps(l.value.data || []);
    } catch {
      // One failed panel beats a blank screen; the card reports its own state.
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const isPresent = PRESENT.includes(att?.status);
  const pending = leaveApps.filter((a) =>
    ["pending", "manager_approved"].includes(a.status),
  ).length;
  const approved = leaveApps.filter((a) => a.status === "hr_approved").length;

  const displayName =
    user?.name ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    "—";
  const avatarUri = user?.profilePhoto?.url || user?.profilePicture;

  const go = (route) => {
    tap();
    navigation.navigate("Work", { screen: route });
  };

  // 1 — on the field, no container. Screen's `header` slot, so the greeting
  // sits at the page gutter and takes the page rhythm like any other child.
  const head = (
    <View style={s.head}>
      <View style={s.headText}>
        <Text style={s.hello}>{greeting()}</Text>
        <Text style={s.name} numberOfLines={1}>
          {displayName}
        </Text>
        <Text style={s.role} numberOfLines={1}>
          {[user?.designation, user?.department].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <Pressable
        onPress={() => navigation.navigate("Profile")}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Open your profile"
      >
        <Avatar name={displayName} uri={avatarUri} size={52} />
      </Pressable>
    </View>
  );

  return (
    <Screen header={head} refreshing={refreshing} onRefresh={onRefresh}>
      {/* 2 — the one heavy object */}
      <View style={[s.heroWrap, glow(colors.heroGradient[0], 0.32)]}>
        <Gradient
          colors={colors.heroGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.hero}
        >
          <View style={s.heroInner}>
            <Text style={s.heroDay}>
              {new Date().toLocaleDateString("en-IN", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </Text>

            {loading ? (
              <Text style={s.heroState}>Checking today…</Text>
            ) : isPresent ? (
              <>
                <Text style={s.heroState}>You're checked in</Text>
                <View style={s.punches}>
                  <View>
                    <Text style={s.punchLbl}>In</Text>
                    <Text style={s.punchVal}>{att?.inTime || "—"}</Text>
                  </View>
                  <View style={s.punchRule} />
                  <View>
                    <Text style={s.punchLbl}>Out</Text>
                    <Text style={s.punchVal}>{att?.outTime || "—"}</Text>
                  </View>
                </View>
              </>
            ) : (
              <>
                <Text style={s.heroState}>Not recorded yet</Text>
                {/* Names the cause and what happens next, rather than
                    "Not synced", which told the employee nothing. */}
                <Text style={s.heroHint}>
                  Attendance comes from the biometric device and can take a
                  few minutes to arrive after you punch.
                </Text>
              </>
            )}
          </View>
        </Gradient>
      </View>

      {/* 3a — a figure row */}
      <Glass>
        <View style={s.figures}>
          <View style={s.figure}>
            <Figure value={leaveApps.length} large />
            <Text
              style={s.figureLbl}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              Requests
            </Text>
          </View>
          <View style={s.figureRule} />
          <View style={s.figure}>
            <Figure value={approved} large tone="success" />
            <Text
              style={s.figureLbl}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              Approved
            </Text>
          </View>
          <View style={s.figureRule} />
          <View style={s.figure}>
            <Figure value={pending} large tone={pending ? "warning" : undefined} />
            <Text
              style={s.figureLbl}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              Awaiting
            </Text>
          </View>
        </View>
      </Glass>

      {/* 3b — a list, not a second tile grid */}
      <Glass padded={false} style={s.listPanel}>
        {ACTIONS.map((a, i) => (
          <Glass.Row
            key={a.key}
            first={i === 0}
            onPress={() => go(a.route)}
            style={s.actionRow}
          >
            {/* A child of a panel paints `inset` — never a panel token.
                See rule 3 in Screen.js. */}
            <View style={s.actionIcon}>
              <Ionicons name={a.icon} size={18} color={colors.accent} />
            </View>
            <Text style={s.actionLabel} numberOfLines={1}>
              {a.label}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </Glass.Row>
        ))}
      </Glass>
    </Screen>
  );
}

// No `safe`, no `scroll`, no `TAB_CLEARANCE`, no backgroundColor on any
// container: all four belong to <Screen>. The only backgrounds below are
// `colors.inset` on a child of a panel and two hairline rules.
const makeStyles = (colors) =>
  StyleSheet.create({
    head: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.snug,
    },
    headText: { flex: 1 },
    hello: { ...type.body, color: colors.textMuted },
    name: {
      ...type.headline,
      color: colors.text,
      marginTop: 2,
    },
    role: { ...type.caption, color: colors.textFaint, marginTop: spacing.hair },

    heroWrap: { borderRadius: radius.card, overflow: "hidden" },
    hero: { borderRadius: radius.card },
    heroInner: { padding: spacing.loose, gap: spacing.tight },
    // Text on the hero gradient is white in both schemes — the gradient is
    // the same saturated ramp either way, so it must not follow the palette.
    // That is what `onHero*` is for; it is a token precisely so this screen
    // does not have to carry raw whites of its own.
    heroDay: { ...type.caption, color: colors.onHeroMuted },
    heroState: { ...type.headline, color: colors.onHero },
    heroHint: {
      ...type.caption,
      color: colors.onHeroMuted,
      marginTop: spacing.hair,
      maxWidth: 300,
      lineHeight: 17,
    },
    punches: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.loose,
      marginTop: spacing.snug,
    },
    punchLbl: { ...type.caption, color: colors.onHeroMuted },
    punchVal: { ...type.figure, color: colors.onHero, marginTop: 2 },
    // A 1px rule, not a region: it cannot split a surface into two tones.
    punchRule: { width: 1, height: 30, backgroundColor: colors.onHeroLine },

    figures: { flexDirection: "row", alignItems: "center" },
    figure: { flex: 1, alignItems: "center", gap: spacing.hair },
    figureLbl: {
      ...type.caption,
      color: colors.textMuted,
      textAlign: "center",
    },
    figureRule: {
      width: layout.hairlineWidth,
      height: 34,
      backgroundColor: colors.hairline,
    },

    listPanel: { paddingVertical: spacing.hair },
    actionRow: { paddingHorizontal: spacing.base },
    actionIcon: {
      width: 34,
      height: 34,
      borderRadius: radius.control,
      backgroundColor: colors.inset,
      alignItems: "center",
      justifyContent: "center",
    },
    actionLabel: { ...type.title, color: colors.text, flex: 1 },
  });
