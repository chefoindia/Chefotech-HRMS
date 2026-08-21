// src/screens/PerformanceScreen.js
//
// The employee's own standing. The backend already computed all of this for
// the HR dashboard; until now no employee could see their own numbers.
//
// A note on colour. DESIGN.md reserves the four saturated hues (Execution
// Emerald, Goal Lime, Policy Magenta, Attendance Grey) for the C1–C4 score
// channels and nothing else — The Four Channels Rule. This screen surfaces
// attendance, leave and SOP data, which is NOT the C1–C4 model, so it stays
// entirely neutral. Borrowing a channel hue here would assert a scoring
// system this app has not adopted, and would make the real component band
// unreadable if C1–C4 is added later.
//
// Layout is `Screen` — the ground, the safe area, the scroller, the gutter,
// the rhythm and the nav-pill clearance all come from there. See the HOW TO
// BUILD A SCREEN block at the top of components/ui/Screen.js. This file sets
// no backgroundColor, reserves no tab space, and draws every surface through
// a surface component.

import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useAuth } from "../context/AuthContext";
import { getApiUrl } from "../lib/api";
import { useResource } from "../lib/resource";
import {
  Screen,
  Glass,
  SlabCard,
  Avatar,
  Figure,
  MetricCell,
  StatusTag,
  SegmentedToggle,
} from "../components/ui";
import { useTheme, spacing, type } from "../theme";

export default function PerformanceScreen() {
  const { apiFetch, user } = useAuth();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);

  const fetcher = useCallback(async () => {
    const res = await apiFetch(getApiUrl(`/performance?year=${year}`));
    if (!res?.success) throw new Error(res?.message || "Could not load performance");
    return res.data;
  }, [apiFetch, year]);

  const { data, loading, refreshing, error, refresh } = useResource(
    `performance:${year}`,
    fetcher,
  );

  const att = data?.attendance;
  const emp = data?.employee;
  const sop = data?.sop;
  const leave = data?.leave;

  const yearOptions = [
    { value: thisYear - 1, label: String(thisYear - 1) },
    { value: thisYear, label: String(thisYear) },
  ];

  return (
    <Screen title="Performance" refreshing={refreshing} onRefresh={refresh}>
      {/* Full-width control, so it is a child rather than a header `right`
          slot — `right` is for compact chrome that sits beside the title. */}
      <SegmentedToggle options={yearOptions} value={year} onChange={setYear} />

      {error ? (
        <Glass>
          <Text style={s.muted}>
            Couldn't load your performance. Pull down to retry.
          </Text>
        </Glass>
      ) : (
        <>
          {/* A person with a measurement — this is exactly what earns the
              stepped slab (The Earned Step Rule). Hero is one per view. */}
          <SlabCard
            size="hero"
            tabContent={
              <>
                <Avatar name={emp?.name || user?.name} size={44} />
                <View style={s.tabText}>
                  <Text style={s.tabName} numberOfLines={1}>
                    {emp?.name || user?.name || "—"}
                  </Text>
                  <Text style={s.tabMeta} numberOfLines={1}>
                    {emp?.designation || emp?.department || ""}
                  </Text>
                </View>
              </>
            }
          >
            <Text style={s.slabKicker}>Attendance rate · {year}</Text>
            <Text style={s.slabFigure}>
              {att?.attendanceRate != null ? `${att.attendanceRate}%` : "—"}
            </Text>

            <View style={s.metrics}>
              <MetricCell label="Present" value={fmt(att?.presentDays)} />
              <MetricCell label="Absent" value={fmt(att?.absentDays)} />
              <MetricCell label="Leave" value={fmt(att?.leaveDaysTotal)} />
              <MetricCell label="Late" value={fmt(att?.lateDays)} />
            </View>
          </SlabCard>

          {leave ? (
            <Glass label="Leave balance">
              <Glass.Row first>
                <Text style={s.rowLabel}>Casual</Text>
                <View style={s.spacer} />
                <Figure value={fmt(leave.cl)} />
              </Glass.Row>
              <Glass.Row>
                <Text style={s.rowLabel}>Sick</Text>
                <View style={s.spacer} />
                <Figure value={fmt(leave.sl)} />
              </Glass.Row>
              <Glass.Row>
                <Text style={s.rowLabel}>Privilege</Text>
                <View style={s.spacer} />
                <Figure value={fmt(leave.pl)} />
              </Glass.Row>
            </Glass>
          ) : null}

          {/* Panels in one composition must differ in height and density —
              this one is denser and carries prose, the one above is figures.
              It stays the quieter surface (no `strong`): the slab already
              holds the page's one forward object. */}
          <Glass label="SOP record">
            {loading ? (
              <Text style={s.muted}>Loading…</Text>
            ) : !sop?.entries?.length ? (
              <Text style={s.muted}>
                No SOP entries for {year}. Nothing has been deducted.
              </Text>
            ) : (
              <>
                <View style={s.sopHead}>
                  <Text style={s.rowLabel}>Total deducted</Text>
                  <View style={s.spacer} />
                  <Figure value={fmt(sop.totalDeducted)} unit="pts" />
                </View>
                {sop.entries.map((e, i) => (
                  <Glass.Row key={`${e.date}-${i}`}>
                    <View style={s.sopText}>
                      <Text style={s.rowLabel} numberOfLines={1}>
                        {e.name || "SOP"}
                      </Text>
                      <Text style={s.rowHint} numberOfLines={1}>
                        {e.date}
                        {e.folderName ? ` · ${e.folderName}` : ""}
                      </Text>
                    </View>
                    {/* `on="panel"` is the default and is correct here: the
                        tag mixes its tone into the panel it sits on, so the
                        fill is a finished colour rather than a wash. */}
                    <StatusTag
                      label={`${e.isCredit ? "−" : "+"}${e.points}`}
                      tone={e.isCredit ? "danger" : "success"}
                    />
                  </Glass.Row>
                ))}
              </>
            )}
          </Glass>
        </>
      )}
    </Screen>
  );
}

// A missing value and a zero mean different things — an em dash says "not
// recorded", 0 says "recorded, and it was none".
function fmt(v) {
  if (v == null) return "—";
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}

const makeStyles = (colors) =>
  StyleSheet.create({
    tabText: { flex: 1 },
    tabName: { ...type.title, color: colors.text },
    tabMeta: { ...type.caption, color: colors.textMuted, marginTop: 2 },

    slabKicker: { ...type.label, color: colors.textMuted },
    slabFigure: {
      ...type.display,
      color: colors.text,
      marginTop: spacing.tight,
      marginBottom: spacing.loose,
    },
    metrics: {
      flexDirection: "row",
      flexWrap: "wrap",
      rowGap: spacing.base,
      columnGap: spacing.section,
    },

    rowLabel: { ...type.body, color: colors.text },
    rowHint: { ...type.caption, color: colors.textFaint, marginTop: 2 },
    sopHead: {
      flexDirection: "row",
      alignItems: "center",
      paddingBottom: spacing.tight,
    },
    sopText: { flex: 1 },
    spacer: { flex: 1 },
    muted: { ...type.body, color: colors.textFaint, paddingVertical: spacing.tight },
  });
