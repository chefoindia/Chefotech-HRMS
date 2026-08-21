// src/components/ui/Figure.js
//
// Every number that is a value rather than prose. Always tabular — figures
// sit in columns and change in place, and proportional digits make them
// jitter as they update.

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme, spacing, type } from "../../theme";

export default function Figure({ value, unit, large, tone, style }) {
  const { colors } = useTheme();
  const color = tone ? colors[tone] || tone : colors.text;

  return (
    <View style={[styles.row, style]}>
      <Text style={[large ? type.figureLarge : type.figure, { color }]}>{value}</Text>
      {unit ? (
        <Text style={[type.caption, styles.unit, { color: colors.textMuted }]}>{unit}</Text>
      ) : null}
    </View>
  );
}

export function MetricCell({ label, value, unit, large, tone, style }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.cell, style]}>
      <Text style={[type.label, { color: colors.textFaint }]}>{label}</Text>
      <Figure value={value} unit={unit} large={large} tone={tone} style={styles.cellFigure} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "baseline", gap: spacing.hair },
  unit: { marginLeft: 2 },
  cell: { gap: spacing.tight },
  cellFigure: { marginTop: 2 },
});
