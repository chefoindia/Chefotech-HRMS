// src/screens/ProfileScreen.js
//
// Profile, on the shared layout (contract: src/components/ui/Screen.js).
//
// What this replaces: a white identity card, a six-row detail table, and a
// 3×2 grid of pastel stat tiles above a month calendar. It rendered light in
// a dark app because every colour was hardcoded, and the tile grid was the
// category default — six equal boxes saying six unrelated things.
//
// The composition now:
//   1. Identity on the field, passed as Screen's `header` — this page's title
//      block IS the person, so it goes in the header slot rather than being a
//      first child that happens to look like one.
//   2. Attendance as ONE figure row (present / leave / absent), not six
//      tiles — the other three numbers were almost always zero and earned no
//      space. Detail belongs on the Attendance screen, which exists for it.
//   3. Their details as a panel of hairline-separated rows.
//   4. Settings and sign-out last, where destructive actions belong.
//
// The month calendar is deliberately NOT duplicated here: the Attendance
// screen owns day-by-day, and shipping the same grid twice is what made this
// screen a scroll.
//
// This file owns no frame. No SafeAreaView, no ScrollView, no RefreshControl,
// no tab clearance, no background — `Screen` owns all of it (rules 1 and 5).
// Every surface is a component, and the only colour a child of a panel paints
// is `colors.inset` (rule 3), which here means the detail icons; the scheme
// switch and the sign-out control are primitives that already know that rule.

import React, { useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAuth } from "../context/AuthContext";
import { getApiUrl } from "../lib/api";
import { useResource } from "../lib/resource";
import {
  Screen,
  Glass,
  Avatar,
  Figure,
  ThemeToggle,
  SecondaryAction,
  InlineAction,
  SegmentedToggle,
  Calendar,
  DayDetail,
} from "../components/ui";
import { confirm } from "../utils/confirm";
import { useTheme, radius, spacing, layout, type } from "../theme";
import { MONTHS } from "../constants/colors";

const PRESENT = ["P", "P*", "P~", "MP", "WFH"];
const ABSENT = ["AB", "LAB", "EAB", "LWP"];
const LEAVE = ["L-CL", "L-SL", "L-EL", "CO"];

// The three named alternatives the appearance switch offers. Values are the
// exact keys setScheme() takes; the labels are the copy that shipped.
const SCHEME_OPTIONS = [
  { value: "system", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function resolveStatus(day) {
  return (
    [
      day.effectiveStatus,
      day.hrFinalStatus,
      day.systemPrediction,
      day.status,
      day.displayStatus,
    ].find(Boolean) || null
  );
}

export default function ProfileScreen() {
  const { user, apiFetch, logout } = useAuth();
  const { colors, scheme, setScheme } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const [syncing, setSyncing] = useState(false);
  const [calMonth, setCalMonth] = useState(month);
  const [calYear, setCalYear] = useState(year);
  const [pickedDay, setPickedDay] = useState(null);

  const fetcher = useCallback(async () => {
    const res = await apiFetch(
      getApiUrl(`/attendance/monthly?month=${calMonth}&year=${calYear}`),
    );
    if (!res?.success) throw new Error(res?.message || "Could not load attendance");
    return res.data || [];
  }, [apiFetch, calMonth, calYear]);

  const { data, refreshing, refresh } = useResource(
    `attendance:${calYear}-${calMonth}`,
    fetcher,
  );

  const totals = useMemo(() => {
    const t = { present: 0, absent: 0, leave: 0 };
    const today = new Date().toISOString().split("T")[0];
    for (const d of data || []) {
      if (d.dateStr && d.dateStr > today) continue;
      const st = resolveStatus(d);
      if (!st) continue;
      if (PRESENT.includes(st)) t.present += 1;
      else if (ABSENT.includes(st)) t.absent += 1;
      else if (LEAVE.includes(st)) t.leave += 1;
    }
    return t;
  }, [data]);

  // InlineAction fires the haptic itself, so this no longer taps — two ticks
  // for one press reads as a stutter, not as feedback.
  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      await apiFetch(getApiUrl("/attendance/sync-today"), { method: "POST" });
      await refresh();
    } catch {
      // Sync is best-effort; the figures simply stay as they were.
    } finally {
      setSyncing(false);
    }
  }, [apiFetch, refresh]);

  const onSignOut = useCallback(async () => {
    const ok = await confirm({
      title: "Sign out?",
      message: "You'll need your phone number and password to sign back in.",
      confirmText: "Sign out",
      destructive: true,
    });
    if (ok) logout();
  }, [logout]);

  const displayName =
    user?.name ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    "—";
  const photo = user?.profilePhoto?.url || user?.profilePicture;

  const DETAILS = [
    { icon: "briefcase-outline", label: "Designation", value: user?.designation || user?.jobTitle },
    { icon: "business-outline", label: "Department", value: user?.department },
    { icon: "call-outline", label: "Phone", value: user?.phone || user?.phoneNumber },
    { icon: "mail-outline", label: "Email", value: user?.email },
    {
      icon: "calendar-outline",
      label: "Joined",
      value: user?.dateOfJoining
        ? new Date(user.dateOfJoining).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : null,
    },
    { icon: "finger-print-outline", label: "Employee ID", value: user?.biometricId },
  ];

  // 1 — identity on the field, in Screen's header slot. Avatar already handles
  // both cases: a photo when there is one, a stable monogram gradient when
  // there is not.
  const header = (
    <View style={s.head}>
      <Avatar name={displayName} uri={photo || undefined} size={76} />
      <View style={s.headText}>
        <Text style={s.name} numberOfLines={2}>
          {displayName}
        </Text>
        <Text style={s.role} numberOfLines={1}>
          {[user?.designation, user?.department].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <ThemeToggle />
    </View>
  );

  return (
    <Screen header={header} refreshing={refreshing} onRefresh={refresh}>
      {/* 2 — one figure row, not six tiles */}
      <Glass
        label={`${MONTHS[month - 1]} attendance`}
        right={
          <InlineAction
            label={syncing ? "Syncing…" : "Sync"}
            onPress={sync}
            disabled={syncing}
            // InlineAction earns its touch target with padding rather than
            // hitSlop; the negative margins hand that padding back to the
            // layout so the label still aligns with the panel's own edge.
            style={s.syncAction}
          />
        }
      >
        <View style={s.figures}>
          <View style={s.figure}>
            <Figure value={totals.present} large />
            <Text style={s.figureLbl} numberOfLines={1}>Present</Text>
          </View>
          <View style={s.figureRule} />
          <View style={s.figure}>
            <Figure value={totals.leave} large />
            <Text style={s.figureLbl} numberOfLines={1}>Leave</Text>
          </View>
          <View style={s.figureRule} />
          <View style={s.figure}>
            <Figure
              value={totals.absent}
              large
              tone={totals.absent > 0 ? "danger" : undefined}
            />
            <Text style={s.figureLbl} numberOfLines={1}>Absent</Text>
          </View>
        </View>
      </Glass>

      {/* 3 — details */}
      <Glass padded={false} style={s.detailPanel}>
        {DETAILS.map((d, i) => (
          <Glass.Row key={d.label} first={i === 0} style={s.detailRow}>
            <View style={s.detailIcon}>
              <Ionicons name={d.icon} size={16} color={colors.accent} />
            </View>
            <View style={s.detailText}>
              <Text style={s.detailLabel}>{d.label}</Text>
              <Text style={s.detailValue} numberOfLines={1}>
                {d.value || "—"}
              </Text>
            </View>
          </Glass.Row>
        ))}
      </Glass>

      {/* 4 — settings, then the destructive action last */}
      <Glass padded={false} style={s.detailPanel}>
        <Glass.Row first style={s.detailRow}>
          <View style={s.detailIcon}>
            <Ionicons name="contrast-outline" size={16} color={colors.accent} />
          </View>
          <Text style={s.settingLabel}>Appearance</Text>
          {/* Three named alternatives = a radiogroup. SegmentedToggle is that
              control: it paints `inset`, marks the selection with opaque
              accent, and carries the radio semantics — all of which this row
              was reimplementing by hand.

              It takes the row's remaining width rather than sitting after a
              flex spacer: its segments are `flex: 1`, and a flex-basis-0 child
              contributes nothing to an auto-width parent under Yoga, so an
              unconstrained track collapses to its own padding. */}
          <SegmentedToggle
            options={SCHEME_OPTIONS}
            value={scheme}
            onChange={setScheme}
            style={s.schemeToggle}
          />
        </Glass.Row>
      </Glass>

      {/* The same Calendar the Attendance screen uses — one component, so a
          change to how a day reads happens in one place. Legend hidden here:
          this is a glance at the month, and Attendance owns the detail. */}
      <Glass label="Attendance calendar">
        <Calendar
          days={data || []}
          month={calMonth}
          year={calYear}
          onChangeMonth={({ month: m, year: y }) => {
            setCalMonth(m);
            setCalYear(y);
            // A day from the previous month is not on screen any more.
            setPickedDay(null);
          }}
          compact
          legend={false}
          selected={pickedDay}
          onSelectDay={(isoDay) => setPickedDay(isoDay)}
        />
        <DayDetail
          dateStr={pickedDay}
          entry={(data || []).find((d) => d.dateStr === pickedDay)}
        />
      </Glass>

      <SecondaryAction
        label="Sign out"
        onPress={onSignOut}
        icon={<Ionicons name="log-out-outline" size={18} color={colors.text} />}
      />

      <Text style={s.footer}>Grav Clothing Pvt. Ltd.</Text>
    </Screen>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    head: { flexDirection: "row", alignItems: "center", gap: spacing.base },
    headText: { flex: 1 },
    name: { ...type.headline, color: colors.text },
    role: { ...type.caption, color: colors.textMuted, marginTop: spacing.hair },

    syncAction: { marginVertical: -spacing.hair, marginRight: -spacing.tight },

    figures: { flexDirection: "row", alignItems: "center" },
    figure: { flex: 1, alignItems: "center", gap: spacing.hair },
    figureLbl: { ...type.caption, color: colors.textMuted, textAlign: "center" },
    figureRule: {
      width: layout.hairlineWidth,
      height: 34,
      backgroundColor: colors.hairline,
    },

    detailPanel: { paddingVertical: spacing.hair },
    detailRow: { paddingHorizontal: spacing.base },
    detailIcon: {
      width: 32,
      height: 32,
      borderRadius: radius.control,
      // `inset` — the one token a child of a panel may paint (rule 3).
      backgroundColor: colors.inset,
      alignItems: "center",
      justifyContent: "center",
    },
    detailText: { flex: 1 },
    detailLabel: { ...type.caption, color: colors.textFaint },
    // A 1px optical nudge, not a spacing step — the label's descenders would
    // otherwise crowd the value's cap line.
    detailValue: { ...type.title, color: colors.text, marginTop: 1 },

    settingLabel: { ...type.title, color: colors.text },
    schemeToggle: { flex: 1 },

    footer: {
      ...type.caption,
      color: colors.textFaint,
      textAlign: "center",
      marginTop: spacing.tight,
    },
  });
