// src/screens/AttendanceScreen.js
//
// A real attendance screen. This file used to be a nine-line alias that
// re-rendered ProfileScreen, on the reasoning that Profile already had a
// calendar — so the app shipped no way to answer "how did my month actually
// go?" without counting coloured dots by eye.
//
// Profile keeps the calendar (the day-by-day picture). This screen carries
// the measurement: totals by status on a slab, then the days themselves.
//
// LAYOUT IS NOT THIS FILE'S BUSINESS. The ground, the safe area, the scroller,
// the gutter, the rhythm between panels, the pull-to-refresh spinner and the
// clearance under the floating nav pill all belong to <Screen>. There is no
// SafeAreaView here, no ScrollView, no TAB_CLEARANCE, and no backgroundColor
// anywhere in the file — every surface is drawn by a surface component
// (SlabCard, Glass, StatusTag, MetricCell). See the HOW TO BUILD A SCREEN
// block at the top of components/ui/Screen.js before changing any of that.

import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useAuth } from "../context/AuthContext";
import { getApiUrl } from "../lib/api";
import { useResource } from "../lib/resource";
import {
  Screen,
  Glass,
  SlabCard,
  StatusTag,
  MetricCell,
  Calendar,
  DayDetail,
} from "../components/ui";
import { useTheme, spacing, type } from "../theme";
// Labels and month names only. No colour comes out of this file — the palette
// there is a set of names ("emerald", "slate") from the pre-theme app, and a
// screen that reads them is a screen that cannot follow the scheme.
import { STATUS_META, MONTHS } from "../constants/colors";

// The backend writes a day's status across several fields depending on how it
// was resolved (biometric prediction, HR override, leave). Same precedence
// ProfileScreen uses — keep the two in step.
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

const PRESENT = ["P", "P*", "P~", "WFH"];
const ABSENT = ["AB", "LAB", "EAB", "LWP"];
const LEAVE = ["L-CL", "L-SL", "L-EL", "CO"];
const PARTIAL = ["HD", "LHD"];
const HOLIDAY = ["PH", "FH", "NH", "OH", "RH"];

// The dot in Calendar and the tag in the Days list describe the same day
// ten pixels apart, so they have to agree. Same buckets, same theme tones as
// the calendar's own legend — and tones, not colours, so the tag resolves
// against whichever scheme is live.
//
// "MP" (miss punch) is toned as present to match the calendar, but note it is
// deliberately NOT in the PRESENT bucket above: the totals count resolved
// attendance, and a miss punch has not been resolved yet. Presentation and
// arithmetic differ here on purpose.
function toneFor(status) {
  if (!status) return "textFaint";
  if (PRESENT.includes(status) || status === "MP") return "success";
  if (ABSENT.includes(status)) return "danger";
  if (LEAVE.includes(status)) return "accent";
  if (PARTIAL.includes(status)) return "warning";
  if (HOLIDAY.includes(status)) return "accentAlt";
  return "textFaint";
}

export default function AttendanceScreen() {
  const { apiFetch } = useAuth();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState(null);
  const [year, setYear] = useState(now.getFullYear());

  const fetcher = useCallback(async () => {
    const res = await apiFetch(
      getApiUrl(`/attendance/monthly?month=${month}&year=${year}`),
    );
    if (!res?.success) throw new Error(res?.message || "Could not load attendance");
    return res.data || [];
  }, [apiFetch, month, year]);

  const { data, loading, refreshing, error, refresh } = useResource(
    `attendance:${year}-${month}`,
    fetcher,
  );

  const days = data || [];

  const totals = useMemo(() => {
    const t = { present: 0, absent: 0, leave: 0, partial: 0 };
    const todayStr = new Date().toISOString().split("T")[0];
    for (const d of days) {
      // Future dates carry a predicted status; counting them would report a
      // month that hasn't happened yet.
      if (d.dateStr && d.dateStr > todayStr) continue;
      const st = resolveStatus(d);
      if (!st) continue;
      if (PRESENT.includes(st)) t.present += 1;
      else if (ABSENT.includes(st)) t.absent += 1;
      else if (LEAVE.includes(st)) t.leave += 1;
      else if (PARTIAL.includes(st)) t.partial += 1;
    }
    return t;
  }, [days]);

  const recent = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    return days
      .filter((d) => d.dateStr && d.dateStr <= todayStr && resolveStatus(d))
      .slice()
      .reverse();
  }, [days]);

  return (
    <Screen title="Attendance" refreshing={refreshing} onRefresh={refresh}>
      {/* Full-width control, so it is a child rather than a header `right`
          slot — `right` is for compact chrome that sits beside the title. */}

      {/* Measurement earns the slab. */}
      <SlabCard
        size="compact"
        tabContent={
          <Text style={s.tabLabel}>
            {MONTHS[month - 1]} {year}
          </Text>
        }
      >
        <View style={s.metrics}>
          <MetricCell label="Present" value={totals.present} large />
          <MetricCell label="Leave" value={totals.leave} large />
          <MetricCell label="Absent" value={totals.absent} large />
          <MetricCell label="Half day" value={totals.partial} large />
        </View>
      </SlabCard>

      <Glass label={`${MONTHS[month - 1]} ${year}`}>
        <Calendar
          onChangeMonth={({ month: m, year: y }) => {
            setMonth(m);
            setYear(y);
          }}
          days={days}
          month={month}
          year={year}
          selected={selectedDay}
          onSelectDay={(c) => setSelectedDay(c.dateStr === selectedDay ? null : c.dateStr)}
        />
        <DayDetail
          dateStr={selectedDay}
          entry={days.find((d) => d.dateStr === selectedDay)}
        />
      </Glass>

      <Glass label="Days">
        {loading ? (
          <Text style={s.muted}>Loading…</Text>
        ) : error ? (
          <Text style={s.muted}>Couldn't load this month. Pull to retry.</Text>
        ) : recent.length === 0 ? (
          <Text style={s.muted}>No attendance recorded yet this month.</Text>
        ) : (
          recent.map((d, i) => {
            const st = resolveStatus(d);
            const meta = STATUS_META[st];
            const dt = new Date(d.dateStr + "T00:00:00");
            return (
              <Glass.Row key={d.dateStr || i} first={i === 0}>
                <Text style={s.day}>
                  {dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </Text>
                <Text style={s.weekday}>
                  {dt.toLocaleDateString("en-IN", { weekday: "short" })}
                </Text>
                <View style={s.spacer} />
                {/* `on="panel"` is the default and is correct here: these rows
                    sit inside a plain <Glass>, so the tag mixes its tint
                    against the panel it is actually painted on. */}
                <StatusTag label={meta?.label || st} tone={toneFor(st)} />
              </Glass.Row>
            );
          })
        )}
      </Glass>
    </Screen>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  tabLabel: { ...type.title, color: colors.text },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.base,
    columnGap: spacing.section,
  },
  day: { ...type.body, color: colors.text, width: 62 },
  weekday: { ...type.caption, color: colors.textFaint },
  spacer: { flex: 1 },
  muted: { ...type.body, color: colors.textFaint, paddingVertical: spacing.tight },
});
