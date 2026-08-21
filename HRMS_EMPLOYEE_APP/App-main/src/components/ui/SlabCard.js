// src/components/ui/SlabCard.js
//
// A measurement card: a header strip carrying identity, then the figures.
//
// THE STEPPED TAB IS GONE, and the reason is worth recording because it is
// the same bug class as the background stripes.
//
// The original silhouette was a raised tab overlapping the card body. Both
// surfaces are translucent, so wherever they overlapped the alpha stacked and
// composited to roughly double the opacity — a visibly lighter rectangle
// sitting on a darker one. That is the "two different colours" in the
// Attendance screenshot. It is not a blur failure; it is two semi-transparent
// surfaces on top of each other.
//
// The step could be kept by making the tab opaque, but an opaque block on a
// translucent card is a worse object: it stops belonging to the same material
// as everything around it. One continuous surface with an internal divider
// reads cleaner and cannot stack alpha with itself.
//
// The API (`size`, `tabContent`, `recede`) is unchanged so callers keep
// working.
//
// `recede` no longer uses View opacity, which was a second and independent
// two-tone path that fired only on receded cards:
//   • opacity < 1 becomes View.setAlpha, making the caster alpha < 1 — so
//     Android takes the transparent-occluder path and fills the ENTIRE umbra
//     of this card's elevation-10 shadow (the largest in the system) beneath
//     a card that is now 45% see-through.
//   • ReactViewGroup.hasOverlappingRendering() returns
//     needsOffscreenAlphaCompositing, which defaults to false, so Android does
//     NOT flatten the subtree first. The 0.55 is applied per drawing op, so
//     the card background and each child background composite as
//     1-(1-0.55a1)(1-0.55a2) rather than the flattened
//     0.55*(1-(1-a1)(1-a2)) — a denser patch bounded exactly by each child's
//     rect.
// Expressing the state as a dimmer opaque COLOUR removes both at once, and
// the scale transform still carries the "further away" reading.

import React from "react";
import { View, StyleSheet } from "react-native";
import { NativeBlurView } from "./native";
import { useTheme, radius, spacing, layout, elevation } from "../../theme";

const GEOMETRY = {
  hero: { corner: radius.card, pad: spacing.loose },
  compact: { corner: radius.band, pad: spacing.base },
};

export default function SlabCard({
  children,
  tabContent,
  size = "hero",
  style,
  recede = false,
}) {
  const { colors } = useTheme();
  const g = GEOMETRY[size] || GEOMETRY.hero;

  return (
    <View
      style={[
        styles.card,
        {
          borderRadius: g.corner,
          backgroundColor: recede ? colors.slabRecede : colors.slab,
          borderWidth: layout.hairlineWidth,
          borderColor: colors.slabBorder,
        },
        elevation.card,
        recede && styles.recede,
        style,
      ]}
    >
      {NativeBlurView ? (
        <NativeBlurView
          intensity={colors.blurIntensity}
          tint={colors.blurTint}
          style={[StyleSheet.absoluteFill, { borderRadius: g.corner }]}
          pointerEvents="none"
        />
      ) : null}

      {/* One lit top edge across the whole card — not per-section, which is
          what made the old step read as a seam. */}
      <View
        pointerEvents="none"
        style={[
          styles.sheen,
          {
            backgroundColor: colors.glassSheen,
            borderTopLeftRadius: g.corner,
            borderTopRightRadius: g.corner,
          },
        ]}
      />

      {tabContent ? (
        <View
          style={[
            styles.header,
            {
              padding: g.pad,
              paddingBottom: spacing.snug,
              // A hairline separates the header from the figures. A divider
              // costs no opacity, so it can never stack.
              borderBottomWidth: layout.hairlineWidth,
              borderBottomColor: colors.hairline,
            },
          ]}
        >
          {tabContent}
        </View>
      ) : null}

      <View style={{ padding: g.pad }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: "hidden" },
  // No `opacity` here. See the docblock: on a shadow caster it both fills the
  // Android umbra and un-flattens the subtree's alpha compositing.
  recede: { transform: [{ scale: 0.97 }] },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.snug },
  sheen: { position: "absolute", top: 0, left: 0, right: 0, height: 1 },
});
