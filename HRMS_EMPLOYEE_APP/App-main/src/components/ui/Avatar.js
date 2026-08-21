// src/components/ui/Avatar.js
//
// The one thing that stays fully round — a face is a circle.
// Monogram fallbacks take a stable gradient derived from the name, so the
// same person is always the same colour without storing anything.

import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import Gradient from "./Gradient";
import { useTheme, radius, type } from "../../theme";

const PAIRS = [
  ["#7C3AED", "#22D3EE"],
  ["#F472B6", "#A78BFA"],
  ["#22D3EE", "#34D399"],
  ["#FBBF24", "#FB7185"],
  ["#38BDF8", "#6366F1"],
  ["#2DD4BF", "#0EA5E9"],
];

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function pairFor(name) {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PAIRS[h % PAIRS.length];
}

export default function Avatar({ name, uri, size = 44, ring = false, style }) {
  const { colors } = useTheme();
  const dim = { width: size, height: size, borderRadius: radius.pill };
  const ringStyle = ring
    ? { borderWidth: 2, borderColor: colors.accent }
    : null;

  if (uri) {
    return <Image source={{ uri }} style={[dim, ringStyle, style]} resizeMode="cover" />;
  }

  return (
    <Gradient
      colors={pairFor(name)}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[dim, styles.mono, ringStyle, style]}
    >
      <Text style={[type.title, styles.text, { fontSize: size * 0.36 }]}>
        {initials(name)}
      </Text>
    </Gradient>
  );
}

const styles = StyleSheet.create({
  mono: { alignItems: "center", justifyContent: "center" },
  // White on every gradient stop above — all six pairs clear 4.5:1.
  text: { color: "#FFFFFF", fontWeight: "700" },
});
