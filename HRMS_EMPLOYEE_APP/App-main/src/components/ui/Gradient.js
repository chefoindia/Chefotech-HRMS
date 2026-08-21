// src/components/ui/Gradient.js
//
// A linear gradient with no native dependency.
//
// THIRD implementation. The two failures are worth recording because both
// looked fine in theory and broke on a real screen:
//
//   v1 — absolute bands at percentage offsets. Percent rounding left gaps
//        between bands; the page showed through as hard stripes.
//   v2 — sibling bands at `flex: 1`. Flex distributes leftover pixels, but
//        each child still rounds to device pixels, and adjacent Views
//        composite with a hairline seam where they meet. On the accent card
//        that read as ruled lines drawn across the gradient.
//
//   v3 — measure the box, then lay bands out at absolute pixel offsets with
//        one pixel of DELIBERATE OVERLAP. Overlapping bands cannot show a
//        seam, because there is no boundary left to show: each band's tail is
//        covered by the next band's head. Rounding still happens; it just has
//        nowhere to land.
//
// The trade is one render pass to measure. Until the box is measured the
// component paints the midpoint colour flat, so there is no flash of nothing.

//   v4 — the band COUNT is derived from the measured extent in device pixels
//        instead of a constant. 40 bands is fine on a 60dp chip and badly
//        wrong on a 900dp page: it quantised the aurora into forty 23dp flat
//        blocks whose worst adjacent step (#26304A → #191722) was ~5/255 in
//        blue, at a razor-sharp full-width horizontal edge. One band per ~2
//        physical pixels drops that below one level, i.e. below the display's
//        own resolution. It also fixes a small-element bug for free: when
//        extent < STEPS the trailing bands rounded to zero width and were
//        clipped off the ramp, so a 24dp badge never reached its second stop
//        and rendered a different colour than a tall element with the same
//        `colors` array.

import React, { useMemo, useState, useCallback } from "react";
import { View, StyleSheet, PixelRatio } from "react-native";
import { NativeLinearGradient } from "./native";

// Used only until the box has measured itself once.
const PRE_MEASURE_STEPS = 40;
// One band per ~2 physical pixels. Below this the eye cannot resolve an edge;
// above it we are paying for Views nobody can see.
const PX_PER_BAND = 2;
const MAX_STEPS = 256;

function parse(c) {
  const s = String(c).trim();
  let m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(s);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), 1];
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$/i.exec(s);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  if (s === "transparent") return [0, 0, 0, 0];
  return [0, 0, 0, 1];
}

const lerp = (a, b, t) => a + (b - a) * t;

export default function Gradient(props) {
  // A real hardware gradient whenever the build has one. Everything below is
  // the fallback for builds that don't — it is a good fallback, but it is
  // still 40 stacked Views approximating what the GPU does in one pass.
  if (NativeLinearGradient) {
    const { children, ...rest } = props;
    return <NativeLinearGradient {...rest}>{children}</NativeLinearGradient>;
  }
  return <FallbackGradient {...props} />;
}

function FallbackGradient({
  colors = ["#000", "#fff"],
  locations,
  start = { x: 0, y: 0 },
  end = { x: 0, y: 1 },
  style,
  children,
  pointerEvents,
}) {
  // NOTE: this fallback cannot draw a diagonal — it lays bands out along one
  // axis. `>=` rather than `>` so a perfectly diagonal request (dx === dy)
  // resolves to HORIZONTAL, which is what every diagonal caller in the app
  // actually wants; Aurora's 0.1,0 → 0.9,1 stays vertical because its dy is
  // larger. Previously `>` collapsed every {0,0}→{1,1} caller to vertical
  // silently, so no diagonal ramp rendered anywhere.
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  const reversed = horizontal ? end.x < start.x : end.y < start.y;
  const [box, setBox] = useState({ w: 0, h: 0 });

  const onLayout = useCallback((e) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((prev) =>
      Math.abs(prev.w - width) < 1 && Math.abs(prev.h - height) < 1
        ? prev
        : { w: width, h: height },
    );
  }, []);

  const extent = horizontal ? box.w : box.h;
  const measured = extent > 0;
  // Band count from the REAL pixel length of the ramp, not a constant. A
  // 900dp page at 3x is 2700 physical px → 256 bands (capped) → ~10px each,
  // where the largest colour step in the dark ramp is under one 8-bit level.
  // A 24dp badge gets ~36 bands and still resolves both its stops.
  const steps = measured
    ? Math.max(2, Math.min(MAX_STEPS, Math.round((extent * PixelRatio.get()) / PX_PER_BAND)))
    : PRE_MEASURE_STEPS;

  const bands = useMemo(() => {
    const stops = colors.map(parse);
    const locs =
      locations && locations.length === colors.length
        ? locations
        : colors.map((_, i) => (colors.length === 1 ? 0 : i / (colors.length - 1)));

    return Array.from({ length: steps }, (_, i) => {
      // Sample at the band's centre; sampling the leading edge shifts the
      // whole ramp half a band and flattens the end stops.
      const t = (i + 0.5) / steps;
      const p = reversed ? 1 - t : t;

      let hi = 1;
      while (hi < locs.length - 1 && p > locs[hi]) hi++;
      const lo = hi - 1;
      const span = locs[hi] - locs[lo] || 1;
      const k = Math.min(1, Math.max(0, (p - locs[lo]) / span));

      const a = stops[lo];
      const b = stops[hi];
      return `rgba(${Math.round(lerp(a[0], b[0], k))},${Math.round(
        lerp(a[1], b[1], k),
      )},${Math.round(lerp(a[2], b[2], k))},${lerp(a[3], b[3], k).toFixed(3)})`;
    });
  }, [colors, locations, reversed, steps]);

  return (
    // overflow:hidden is load-bearing, not tidiness: without it the absolutely
    // positioned bands paint square corners over any borderRadius the caller
    // set, which turned every circular avatar into a square block.
    <View
      style={[style, { overflow: "hidden" }]}
      pointerEvents={pointerEvents}
      onLayout={onLayout}
    >
      <View
        style={[
          StyleSheet.absoluteFill,
          // The FIRST stop until measured, not the midpoint. Before measuring
          // this flat colour is all there is, and a gradient that flashes its
          // middle colour and then snaps to its start is a visible pop; the
          // first band is where the ramp actually begins. It also backstops
          // any band that fails to cover, so the page never shows through.
          { backgroundColor: bands[0], overflow: "hidden" },
        ]}
        pointerEvents="none"
      >
        {measured &&
          bands.map((c, i) => {
            // Integer-rounded boundaries: band i ends exactly where band i+1
            // begins, so there is neither a gap nor an overlap.
            //
            // The previous version added 1px of overlap to kill seams. That
            // works for OPAQUE ramps and is actively wrong for translucent
            // ones: two semi-transparent bands stacked over each other
            // composite to a darker value, so every seam became a dark stripe.
            // The aurora layers are translucent, which is why the background
            // was ruled with lines. Sharing an exact integer edge has neither
            // failure mode.
            const startPx = Math.round((i * extent) / steps);
            const endPx = Math.round(((i + 1) * extent) / steps);
            const offset = startPx;
            const size = Math.max(1, endPx - startPx);
            return (
              <View
                key={i}
                style={
                  horizontal
                    ? { position: "absolute", top: 0, bottom: 0, left: offset, width: size, backgroundColor: c }
                    : { position: "absolute", left: 0, right: 0, top: offset, height: size, backgroundColor: c }
                }
              />
            );
          })}
      </View>
      {children}
    </View>
  );
}
