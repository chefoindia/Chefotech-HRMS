// src/components/ui/Calendar.js
//
// THE calendar. One component, three callers: Attendance, Profile and
// Regularize.
//
// ── The grid ──────────────────────────────────────────────────────────────
//
//   · Status is a FILLED DOT under the date, never a tint on the number.
//     Colouring the digit fights legibility, and the darkest status ends up
//     shouting loudest for no reason.
//   · Future days render dimmed with no dot. The backend returns a PREDICTION
//     for them; painting a prediction as though it happened is a calendar
//     that lies.
//   · Today gets a ring, the selection gets a fill. Different ideas, so they
//     must not share a treatment.
//   · The dot slot is always reserved, so rows never shift by a pixel between
//     a day that has a status and one that does not.
//
// The month rail scrolls horizontally and snaps. Months are a continuum;
// paging with two chevrons makes the user do arithmetic to reach March.

import React, { useCallback, useMemo, useRef, useEffect } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useTheme, radius, spacing, layout, type, ms, FONT } from "../../theme";
import { tap } from "../../lib/feedback";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const PRESENT = ["P", "P*", "P~", "MP", "WFH"];
const ABSENT = ["AB", "LAB", "EAB", "LWP"];
const LEAVE = ["L-CL", "L-SL", "L-EL", "CO"];
const PARTIAL = ["HD", "LHD"];
const HOLIDAY = ["PH", "FH", "NH", "OH", "RH"];

/** A standard working day, used as the bar's full height. */
const FULL_DAY_MINS = 8 * 60;

export function resolveStatus(day) {
  if (!day) return null;
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

export function toneFor(status, colors) {
  if (!status) return null;
  if (PRESENT.includes(status)) return colors.success;
  if (ABSENT.includes(status)) return colors.danger;
  if (LEAVE.includes(status)) return colors.accent;
  if (PARTIAL.includes(status)) return colors.warning;
  if (HOLIDAY.includes(status)) return colors.accentAlt;
  if (status === "WO") return colors.textFaint;
  return colors.textFaint;
}

/** Minutes worked on a day, from whichever field the backend filled. */
export function workedMins(entry) {
  if (!entry) return 0;
  const n = Number(entry.netWorkMins ?? entry.totalSpanMins ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const iso = (y, m, d) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function recentMonths(count = 12) {
  const now = new Date();
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ month: d.getMonth() + 1, year: d.getFullYear() });
  }
  return out;
}

export default function Calendar({
  days,
  month,
  year,
  onChangeMonth,
  selected,
  onSelectDay,
  months = 12,
  allowFuture = false,
  compact = false,
  legend = true,
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors, compact), [colors, compact]);
  const railRef = useRef(null);

  const rail = useMemo(() => recentMonths(months), [months]);
  const activeIndex = rail.findIndex((r) => r.month === month && r.year === year);

  useEffect(() => {
    if (activeIndex < 0) return;
    const t = setTimeout(() => {
      railRef.current?.scrollTo({
        x: Math.max(0, activeIndex * ms(78) - ms(78)),
        animated: false,
      });
    }, 0);
    return () => clearTimeout(t);
  }, [activeIndex]);

  const byDate = useMemo(() => {
    const m = new Map();
    for (const d of days || []) if (d?.dateStr) m.set(d.dateStr, d);
    return m;
  }, [days]);

  const cells = useMemo(() => {
    const firstDow = new Date(year, month - 1, 1).getDay();
    const count = new Date(year, month, 0).getDate();
    const out = [];
    for (let i = 0; i < firstDow; i++) out.push(null);
    for (let d = 1; d <= count; d++) {
      const ds = iso(year, month, d);
      out.push({ day: d, dateStr: ds, entry: byDate.get(ds) });
    }
    return out;
  }, [month, year, byDate]);

  // Chunked into weeks so each row can tile exactly — see weekRow below.
  const weeks = useMemo(() => {
    const out = [];
    for (let i = 0; i < cells.length; i += 7) {
      const w = cells.slice(i, i + 7);
      while (w.length < 7) w.push(null); // pad the final week
      out.push(w);
    }
    return out;
  }, [cells]);

  const today = new Date().toISOString().split("T")[0];

  const pick = useCallback(
    (cell) => {
      tap();
      onSelectDay?.(cell.dateStr === selected ? null : cell.dateStr, cell.entry);
    },
    [onSelectDay, selected],
  );

  return (
    <View>
      {onChangeMonth ? (
        <ScrollView
          ref={railRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.rail}
          snapToInterval={ms(78)}
          decelerationRate="fast"
        >
          {rail.map((r) => {
            const active = r.month === month && r.year === year;
            return (
              <Pressable
                key={`${r.year}-${r.month}`}
                onPress={() => {
                  tap();
                  onChangeMonth(r);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${MONTH_SHORT[r.month - 1]} ${r.year}`}
                style={[s.railItem, active && { backgroundColor: colors.accent }]}
              >
                <Text style={[s.railMonth, active && { color: colors.onAccent }]}>
                  {MONTH_SHORT[r.month - 1]}
                </Text>
                <Text style={[s.railYear, active && { color: colors.onAccent }]}>
                  {String(r.year).slice(2)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={s.week}>
        {DAY_LABELS.map((l, i) => (
          <Text key={i} style={s.weekCell}>
            {l}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={s.weekRow}>
        {week.map((c, i) => {
          if (!c) return <View key={`e${wi}-${i}`} style={s.cell} />;

          const future = c.dateStr > today;
          const disabled = future && !allowFuture;
          const status = resolveStatus(c.entry);
          const tone = disabled ? null : toneFor(status, colors);
          const isToday = c.dateStr === today;
          const isSelected = selected === c.dateStr;

          return (
            <Pressable
              key={c.dateStr}
              onPress={() => !disabled && pick(c)}
              disabled={disabled || !onSelectDay}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected, disabled }}
              accessibilityLabel={`${c.day} ${MONTH_SHORT[month - 1]}${status ? `, ${status}` : ""}`}
              style={s.cell}
            >
              <View
                style={[
                  s.dayBox,
                  isToday && !isSelected && { borderColor: colors.accent },
                  isSelected && {
                    backgroundColor: colors.accent,
                    borderColor: colors.accent,
                  },
                ]}
              >
                <Text
                  style={[
                    s.dayText,
                    disabled && s.dayTextDim,
                    isSelected && { color: colors.onAccent },
                  ]}
                >
                  {c.day}
                </Text>
              </View>
              <View style={s.dotSlot}>
                {tone ? <View style={[s.dot, { backgroundColor: tone }]} /> : null}
              </View>
            </Pressable>
          );
        })}
        </View>
      ))}

      {legend ? (
        <View style={s.legend}>
          <View style={s.legendKeys}>
            {[
              ["Present", colors.success],
              ["Leave", colors.accent],
              ["Absent", colors.danger],
              ["Half day", colors.warning],
            ].map(([label, tone]) => (
              <View key={label} style={s.legendItem}>
                <View style={[s.dot, { backgroundColor: tone }]} />
                <Text style={s.legendText}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors, compact) =>
  StyleSheet.create({
    rail: { gap: spacing.tight, paddingBottom: spacing.snug },
    railItem: {
      width: ms(70),
      paddingVertical: spacing.tight,
      borderRadius: radius.control,
      alignItems: "center",
      backgroundColor: colors.inset,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
    },
    railMonth: { ...type.caption, color: colors.text, fontFamily: FONT.semibold },
    railYear: { ...type.caption, color: colors.textFaint, fontSize: ms(10) },

    week: { flexDirection: "row", marginBottom: spacing.tight },
    weekCell: {
      ...type.caption,
      color: colors.textFaint,
      fontSize: ms(10),
      flex: 1,
      textAlign: "center",
    },

    // Weeks are ROWS of seven flex:1 cells, not one wrapping grid.
    //
    // `width: ${100/7}%` looks correct and is not: each cell rounds to device
    // pixels independently, and seven rounded cells can total more than the
    // container — so the seventh wraps to its own line and the Saturday column
    // renders empty. flex:1 distributes the remainder exactly, at any width,
    // on any density. Same failure mode as the gradient bands.
    weekRow: { flexDirection: "row" },
    cell: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 3,
    },
    dayBox: {
      width: compact ? ms(28) : ms(32),
      height: compact ? ms(28) : ms(32),
      borderRadius: radius.control,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1.5,
      borderColor: "transparent",
    },
    dayText: { ...type.caption, color: colors.text, fontFamily: FONT.medium },
    dayTextDim: { color: colors.textFaint, opacity: 0.45 },
    dotSlot: { height: ms(8), justifyContent: "center" },
    dot: { width: ms(5), height: ms(5), borderRadius: ms(3) },

    legend: {
      marginTop: spacing.snug,
      paddingTop: spacing.snug,
      borderTopWidth: layout.hairlineWidth,
      borderTopColor: colors.hairline,
      gap: spacing.tight,
    },
    legendNote: { ...type.caption, color: colors.textFaint, fontSize: ms(11) },
    legendKeys: { flexDirection: "row", flexWrap: "wrap", gap: spacing.snug },
    legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.hair },
    legendSwatch: { width: ms(8), height: ms(8), borderRadius: ms(2) },
    legendText: { ...type.caption, color: colors.textMuted, fontSize: ms(11) },
  });
