// src/components/ui/DatePickerSheet.js
//
// The app's own date picker, replacing the platform dialog.
//
// @react-native-community/datetimepicker renders the OS widget — on Android
// that is the green Material dialog with its own typeface, its own accent and
// its own corner radius, and on iOS a grey spinner. Neither belongs to this
// app, and the two look nothing like each other, which breaks the "same UI on
// both platforms" requirement at the exact moment a user is filling a form.
//
// This is one component, so Android and iOS get the identical picker.
//
// It is NOT the attendance Calendar. That one reports history — statuses,
// dots, a month rail of the last twelve months. This one chooses a date,
// often a FUTURE one (leave starts tomorrow), so it needs free month
// navigation in both directions and has no status to show. Sharing a
// component between them would mean a pile of flags on both.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, Modal, StyleSheet } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme, radius, spacing, layout, type, ms, FONT } from "../../theme";
import { tap } from "../../lib/feedback";
import Glass from "./Glass";
import { PrimaryAction, InlineAction } from "./Controls";
import Wheel, { WHEEL_HEIGHT } from "./Wheel";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n) => String(n).padStart(2, "0");
const toISO = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function parseISO(v) {
  if (!v) return null;
  const [y, m, d] = String(v).split("-").map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

/**
 * @param visible
 * @param value        ISO "YYYY-MM-DD" or null
 * @param onChange     (iso) => void — fired on Done
 * @param onClose
 * @param title
 * @param minDate/maxDate  ISO strings, inclusive
 */
export default function DatePickerSheet({
  visible,
  value,
  onChange,
  onClose,
  title = "Pick a date",
  minDate,
  maxDate,
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const today = new Date();
  const initial = parseISO(value) || {
    y: today.getFullYear(),
    m: today.getMonth() + 1,
    d: today.getDate(),
  };

  const [view, setView] = useState({ y: initial.y, m: initial.m, d: initial.d });

  // Clamp the day when the month changes: rolling from 31 Jan to February
  // must not produce 31 Feb.
  const clampDay = (v, nextMonth) => {
    const max = new Date(v.y, nextMonth, 0).getDate();
    setView((cur) => ({ ...cur, d: Math.min(cur.d, max) }));
    return nextMonth;
  };

  const daysInMonth = new Date(view.y, view.m, 0).getDate();
  const dayItems = Array.from({ length: daysInMonth }, (_, i) => ({
    value: i + 1,
    label: String(i + 1),
  }));
  // Ten years back, two forward: leave is requested for the near future and
  // corrected for the recent past; a hundred-year drum is a scroll, not a
  // choice.
  const thisYear = today.getFullYear();
  const yearItems = Array.from({ length: 13 }, (_, i) => {
    const y = thisYear - 10 + i;
    return { value: y, label: String(y) };
  });

  const picked = toISO(view.y, view.m, Math.min(view.d, daysInMonth));

  // Re-open on the value the caller holds, not on wherever the user last
  // browsed to. A picker that reopens somewhere else loses its place.
  useEffect(() => {
    if (!visible) return;
    const p = parseISO(value) || {
      y: today.getFullYear(),
      m: today.getMonth() + 1,
    };
    setView({ y: p.y, m: p.m, d: p.d || today.getDate() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, value]);




  const todayISO = toISO(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const blocked = (iso) =>
    (minDate && iso < minDate) || (maxDate && iso > maxDate);

  const headline = picked
    ? new Date(picked + "T00:00:00").toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : "No date chosen";

  // A <Modal visible={false}> still RENDERS its children in React Native — it
  // only hides the host view. Every date/time field on a screen was therefore
  // holding a full set of wheels mounted at all times, and opening one forced
  // layout across all of them.
  //
  // This guard MUST sit below every hook. Placing it above them made the
  // component call zero hooks when closed and N when open, which is a
  // conditional-hook violation — React reported it as
  // "Expected static flag was missing".
  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      // No animation: "fade" costs ~300ms before the sheet is usable, and on
      // a control opened this often that IS the perceived slowness. The
      // backdrop appearing instantly reads as responsive, not abrupt.
      animationType="none"
      statusBarTranslucent
      hardwareAccelerated
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close date picker"
        />

        <Glass strong style={s.sheet}>
          <Text style={s.kicker}>{title}</Text>
          <Text style={s.headline}>{headline}</Text>

          {/* Day / month / year drums — the same rolling control as the time
              picker, so every date and time in the app is set the same way on
              both platforms. */}
          <View style={s.wheels}>
            <Wheel
              items={dayItems}
              value={view.d}
              onChange={(d) => setView((v) => ({ ...v, d }))}
              width={ms(62)}
            />
            <Wheel
              items={MONTHS_LONG.map((m, i) => ({ value: i + 1, label: m.slice(0, 3) }))}
              value={view.m}
              onChange={(m) => setView((v) => ({ ...v, m: clampDay(v, m) }))}
              width={ms(74)}
            />
            <Wheel
              items={yearItems}
              value={view.y}
              onChange={(y) => setView((v) => ({ ...v, y }))}
              width={ms(74)}
            />
          </View>

          <View style={s.actions}>
            <InlineAction label="Cancel" onPress={onClose} tone="textMuted" />
            <View style={{ flex: 1 }} />
            <InlineAction
              label="Today"
              onPress={() =>
                setView({
                  y: today.getFullYear(),
                  m: today.getMonth() + 1,
                  d: today.getDate(),
                })
              }
            />
          </View>

          <PrimaryAction
            label="Use this date"
            disabled={blocked(picked)}
            onPress={() => {
              onChange?.(picked);
              onClose?.();
            }}
          />
        </Glass>
      </View>
    </Modal>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    wheels: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      height: WHEEL_HEIGHT,
      gap: ms(6),
    },
    overlay: { flex: 1, justifyContent: "center", padding: spacing.loose },
    sheet: { borderRadius: radius.sheet, gap: spacing.tight },

    kicker: { ...type.caption, color: colors.textMuted },
    headline: {
      ...type.headline,
      color: colors.text,
      marginBottom: spacing.tight,
    },

    actions: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: spacing.tight,
    },
  });
