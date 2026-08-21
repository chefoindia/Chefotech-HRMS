// src/components/ui/Wheel.js
//
// A scroll wheel — the rolling drum every phone uses to set a time.
//
// Built from a plain ScrollView with snapToInterval, so it needs no native
// module and behaves identically on Android and iOS. The OS pickers do NOT:
// Android shows a Material clock face and iOS a UIDatePicker drum, which is
// exactly the split this app is trying to remove.
//
// Why a wheel rather than a grid of buttons: a grid has to quantise. The
// 5-minute grid this replaces could not express 9:17, and an attendance
// correction is precisely the case where the real minute matters — an
// employee regularising a missed punch knows they arrived at 9:17, and
// rounding it to 9:15 puts a number in the record that never happened. A
// wheel holds all sixty minutes in the same space a grid gave twelve.
//
// Implementation notes that matter:
//   · Padding of exactly (VISIBLE-1)/2 items top and bottom puts item 0 in
//     the centre band at scrollY = 0. Without it every wheel opens offset by
//     two rows and the highlighted value is not the selected one.
//   · The selection is committed on momentum end AND on drag end. Momentum
//     alone misses a slow drag that stops without flinging, which feels like
//     the wheel ignored you.
//   · Items are plain Views, NOT Pressables. Sixty Pressables per wheel means
//     sixty gesture responders registered on mount, which is most of what made
//     the sheet slow to open. A wheel is scrolled, not tapped; losing
//     tap-to-select costs almost nothing and the open is visibly faster.
//   · No transforms. A 3D cylinder effect needs a per-item interpolation on
//     scroll position — sixty driven animations fighting the JS thread for a
//     flourish nobody asked for.

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useTheme, radius, layout, type, ms, FONT } from "../../theme";
import { tap } from "../../lib/feedback";

export const ITEM_H = 40;
const VISIBLE = 5; // odd, so there is a true centre row
const PAD = ((VISIBLE - 1) / 2) * ITEM_H;

export const WHEEL_HEIGHT = VISIBLE * ITEM_H;

/**
 * @param items   array of { value, label }
 * @param value   currently selected value
 * @param onChange(value)
 * @param width   column width
 */
export default function Wheel({
  items,
  value,
  onChange,
  width = 76,
  testID,
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const ref = useRef(null);

  // NOT looped. Repeating the list to fake an infinite drum tripled the row
  // count — 60 minutes became 180 mounted rows per wheel — and the sheet took
  // visibly longer to open for it. A wheel with ends is the correct trade
  // here: the cost was paid on every open, the benefit only when someone
  // scrolled past midnight.
  const data = items;

  const index = Math.max(0, items.findIndex((i) => i.value === value));
  const lastCommitted = useRef(index);

  // Follow the value when the caller changes it (e.g. the "Now" shortcut),
  // but never fight the user mid-scroll.
  useEffect(() => {
    if (index === lastCommitted.current) return;
    lastCommitted.current = index;
    const t = setTimeout(
      () => ref.current?.scrollTo({ y: index * ITEM_H, animated: true }),
      0,
    );
    return () => clearTimeout(t);
  }, [index]);

  const commit = useCallback(
    (e) => {
      const y = e.nativeEvent.contentOffset.y;
      const i = Math.min(data.length - 1, Math.max(0, Math.round(y / ITEM_H)));
      if (i === lastCommitted.current) return;
      lastCommitted.current = i;
      tap();
      onChange?.(data[i].value);

    },
    [data, onChange],
  );

  return (
    <View style={[s.wrap, { width, height: WHEEL_HEIGHT }]}>
      {/* The centre band. Drawn behind the items so the selected value sits
          on it rather than under a tint. */}
      <View pointerEvents="none" style={s.band} />

      <ScrollView
        ref={ref}
        testID={testID}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        // "normal" carries a fling much further than "fast", which is what
        // makes a drum feel like it has weight; snapToInterval still lands it
        // exactly on a row.
        decelerationRate="normal"
        disableIntervalMomentum={false}
        scrollEventThrottle={16}
        contentOffset={{ x: 0, y: index * ITEM_H }}
        contentContainerStyle={{ paddingVertical: PAD }}
        onMomentumScrollEnd={commit}
        onScrollEndDrag={commit}
        nestedScrollEnabled
        removeClippedSubviews
      >
        {data.map((it, i) => {
          const active = i === index;
          return (
            <View key={String(it.value)} style={s.item}>
              <Text style={[s.itemText, active && s.itemTextActive]}>
                {it.label}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    wrap: { overflow: "hidden" },
    band: {
      position: "absolute",
      left: 0,
      right: 0,
      top: PAD,
      height: ITEM_H,
      borderRadius: radius.control,
      backgroundColor: colors.inset,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
    },
    item: { height: ITEM_H, alignItems: "center", justifyContent: "center" },
    itemText: {
      ...type.body,
      color: colors.textFaint,
      fontFamily: FONT.medium,
      fontSize: ms(16),
    },
    itemTextActive: {
      color: colors.text,
      fontFamily: FONT.bold,
      fontSize: ms(19),
    },
  });
