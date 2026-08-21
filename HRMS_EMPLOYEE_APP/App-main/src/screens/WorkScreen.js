// src/screens/WorkScreen.js
//
// The Work hub. Five bottom tabs is the practical ceiling on a phone, so the
// four work surfaces — leave, overtime, attendance, regularize — group behind
// one tab rather than fighting for a slot.
//
// Tasks was removed entirely: it showed interview tasks that apply to almost
// nobody here and rendered empty for everyone else. Regularize took its place
// because correcting a missed punch is what employees actually need.
//
// It is not a menu. Each row carries its own live count, so the hub answers
// "what needs me?" without opening anything.
//
// Layout is <Screen>'s (see the HOW TO BUILD A SCREEN block in
// components/ui/Screen.js): the ground, the safe area, the scroller, the
// gutter, the page head and the nav-pill clearance are not this file's
// business. What is left here is one panel of rows — so the panel is
// full-bleed (`padded={false}`) and each row owns its horizontal inset, which
// is what lets the hairline between rows run the full width of the panel
// instead of floating inside it.

import React, { useCallback } from "react";
import { View, Text, StyleSheet } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAuth } from "../context/AuthContext";
import { getApiUrl, API_CONFIG } from "../lib/api";
import { useResource } from "../lib/resource";
import { Screen, Glass, Figure } from "../components/ui";
import { useTheme, radius, spacing, type } from "../theme";

const AREAS = [
  {
    key: "leave",
    route: "Leave",
    label: "Leave",
    hint: "Balance, history and new requests",
    icon: "calendar-outline",
  },
  {
    key: "overtime",
    route: "Overtime",
    label: "Overtime",
    hint: "Logged hours and approvals",
    icon: "time-outline",
  },
  {
    key: "attendance",
    route: "Attendance",
    label: "Attendance",
    hint: "This month, day by day",
    icon: "finger-print-outline",
  },
  {
    key: "regularize",
    route: "Regularize",
    label: "Regularize",
    hint: "Fix a missed or wrong punch",
    icon: "build-outline",
  },
  {
    // `key` is what counts[a.key] reads — it must match the key the fetcher
    // below returns, not the route name.
    key: "documents",
    route: "Documents",
    label: "Documents",
    hint: "Request letters and open released ones",
    icon: "document-text-outline",
  },
];

export default function WorkScreen({ navigation }) {
  const { apiFetch } = useAuth();
  const { colors } = useTheme();
  const s = React.useMemo(() => makeStyles(colors), [colors]);

  const fetcher = useCallback(async () => {
    // One request per area, in parallel, and a failure in any one of them
    // must not blank the whole hub — a missing count is far better than a
    // screen that refuses to render.
    const [overtime, documents] = await Promise.allSettled([
      apiFetch(getApiUrl("/overtime/my")),
      apiFetch(getApiUrl(API_CONFIG.endpoints.documents.list)),
    ]);

    const otList =
      overtime.status === "fulfilled" && overtime.value?.success
        ? overtime.value.data || []
        : [];

    // The employee-facing list: a document HR has generated but not released
    // is not in it, so this counts open ASKS and nothing else.
    const docList =
      documents.status === "fulfilled" && documents.value?.success
        ? documents.value.data || []
        : [];

    return {
      overtime: otList.filter((o) => o.status === "pending").length,
      documents: docList.filter((d) => d.status === "requested").length,
    };
  }, [apiFetch]);

  const { data, refreshing, refresh } = useResource("work:counts", fetcher);
  const counts = data || {};

  return (
    <Screen
      title="Work"
      subtitle="Leave, overtime, attendance, punch corrections and documents."
      refreshing={refreshing}
      onRefresh={refresh}
    >
      <Glass padded={false} style={s.panel}>
        {AREAS.map((a, i) => {
          const count = counts[a.key];
          return (
            <Glass.Row
              key={a.key}
              first={i === 0}
              onPress={() => navigation.navigate(a.route)}
            >
              {/* `inset` is the only surface a child of a panel may paint.
                  See rule 3 in Screen.js. */}
              <View style={s.rowIcon}>
                <Ionicons name={a.icon} size={16} color={colors.accent} />
              </View>
              <View style={s.rowText}>
                <Text style={s.rowLabel}>{a.label}</Text>
                <Text style={s.rowHint} numberOfLines={1}>
                  {a.hint}
                </Text>
              </View>
              {count > 0 ? <Figure value={count} /> : null}
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </Glass.Row>
          );
        })}
      </Glass>
    </Screen>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    // The panel draws no gutter of its own; the hair of vertical padding just
    // keeps the first and last row off the rounded corners.
    panel: { paddingVertical: spacing.hair },
    row: { paddingHorizontal: spacing.base },
    rowIcon: {
      width: 32,
      height: 32,
      borderRadius: radius.control,
      backgroundColor: colors.inset,
      alignItems: "center",
      justifyContent: "center",
    },
    rowText: { flex: 1 },
    rowLabel: { ...type.title, color: colors.text },
    rowHint: { ...type.caption, color: colors.textFaint, marginTop: spacing.hair },
  });
