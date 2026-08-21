// src/components/ui/DayDetail.js
//
// What a selected day actually contains: status, check-in, check-out, hours.
//
// This existed on the old Profile screen and was lost when the calendar was
// rebuilt — selecting a day did nothing, which makes the calendar a picture
// rather than a control. It lives here so Profile and Attendance show the
// same thing for the same tap.
//
// The empty state is deliberately specific. "No data" is what the old screen
// said, and it does not tell an employee whether the device missed their
// punch or whether the day simply has not synced yet — which is exactly the
// moment they need to know whether to raise a regularization.

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme, radius, spacing, layout, type, ms, FONT } from "../../theme";
import { resolveStatus, toneFor, workedMins } from "./Calendar";
import { STATUS_META } from "../../constants/colors";

function fmtMins(m) {
  const n = Math.max(0, Math.round(m || 0));
  const h = Math.floor(n / 60);
  const r = n % 60;
  if (h && r) return `${h}h ${r}m`;
  if (h) return `${h}h`;
  return `${r}m`;
}

export default function DayDetail({ dateStr, entry, style }) {
  const { colors } = useTheme();
  const s = React.useMemo(() => makeStyles(colors), [colors]);

  if (!dateStr) return null;

  const status = resolveStatus(entry);
  const tone = toneFor(status, colors) || colors.textFaint;
  const label = STATUS_META[status]?.label || status || "Not recorded";
  const mins = workedMins(entry);

  const pretty = new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const rows = [
    { icon: "log-in-outline", label: "Check in", value: entry?.inTime || "—" },
    { icon: "log-out-outline", label: "Check out", value: entry?.finalOut || entry?.outTime || "—" },
    {
      icon: "hourglass-outline",
      label: "Worked",
      value: entry?.workDisplay || (mins ? fmtMins(mins) : "—"),
    },
  ];

  return (
    <View style={[s.wrap, style]}>
      <View style={s.head}>
        <View style={[s.dot, { backgroundColor: tone }]} />
        <Text style={s.date}>{pretty}</Text>
        <View style={{ flex: 1 }} />
        <Text style={[s.status, { color: tone }]} numberOfLines={1}>
          {label}
        </Text>
      </View>

      {entry ? (
        <View style={s.rows}>
          {rows.map((r) => (
            <View key={r.label} style={s.row}>
              <Ionicons name={r.icon} size={14} color={colors.textFaint} />
              <Text style={s.rowLabel}>{r.label}</Text>
              <View style={{ flex: 1 }} />
              <Text style={s.rowValue}>{r.value}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={s.empty}>
          Nothing synced for this day yet. If you were at work, raise it under
          Work → Regularize.
        </Text>
      )}
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    wrap: {
      marginTop: spacing.snug,
      paddingTop: spacing.snug,
      borderTopWidth: layout.hairlineWidth,
      borderTopColor: colors.hairline,
      gap: spacing.tight,
    },
    head: { flexDirection: "row", alignItems: "center", gap: spacing.tight },
    dot: { width: ms(8), height: ms(8), borderRadius: ms(4) },
    date: { ...type.caption, color: colors.text, fontFamily: FONT.semibold },
    status: { ...type.caption, fontFamily: FONT.semibold },

    rows: {
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
      paddingHorizontal: spacing.snug,
      paddingVertical: spacing.tight,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.tight,
      paddingVertical: spacing.hair,
    },
    rowLabel: { ...type.caption, color: colors.textMuted },
    rowValue: { ...type.caption, color: colors.text, fontFamily: FONT.semibold },

    empty: { ...type.caption, color: colors.textMuted, lineHeight: ms(17) },
  });
