// src/components/ui/TimePickerSheet.js
//
// The app's own clock-time picker — the sibling of DatePickerSheet, and it
// exists for the same reason.
//
// @react-native-community/datetimepicker renders the OS widget: on Android a
// Material clock dial in Google's typeface and accent, on iOS a grey spinner.
// They look nothing like each other and nothing like this app, and a user only
// ever meets them mid-form, which is the worst possible moment for the
// interface to change identity. This is one component, so both platforms get
// the identical picker.
//
// ── Why a grid and not a wheel ────────────────────────────────────────────
//
// A spinner needs momentum scrolling, snap physics and a masked viewport to
// feel right, and RN's ScrollView gives none of that for free — the honest
// version is a native module, which this app does not take. A grid of taps is
// one gesture per component (hour, minute, half of the day), each landing
// exactly where the finger went, and it costs core RN and nothing else.
//
// Minutes are FIVE-MINUTE STEPS. This picker exists to state when someone
// arrived or left on a day the biometric device missed them; nobody remembers
// 09:37, and offering sixty cells implies a precision the input does not have.
// The contract's wire format is "HH:mm" 24-hour, which every multiple of five
// satisfies.
//
// The value in and out is a "HH:mm" 24-hour string — never a Date, never an
// ISO string. The backend materialises it with parseTimeOnDateIST(t, dateStr),
// which splits on ":" and would read an ISO string as garbage.

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, Modal, StyleSheet } from "react-native";
import { useTheme, radius, spacing, layout, type, ms, FONT } from "../../theme";
import { tap } from "../../lib/feedback";
import Wheel, { WHEEL_HEIGHT } from "./Wheel";
import Glass from "./Glass";
import { PrimaryAction, InlineAction } from "./Controls";

const pad = (n) => String(n).padStart(2, "0");

const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
// All sixty. The old 5-minute grid could not express 9:17, and an attendance
// correction is exactly where the real minute matters — rounding a missed
// punch to the nearest five puts a time in the record that never happened.
// A wheel holds all sixty in the space a grid gave twelve.
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/** "HH:mm" → {h12, minute, meridiem} in the 12-hour terms the grid speaks. */
function parseHHMM(v) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v || ""));
  if (!m) return null;
  const h24 = Number(m[1]);
  return {
    h12: h24 % 12 === 0 ? 12 : h24 % 12,
    // Snap to the nearest offered step so a value typed by HR — or one that
    // came back from an older client — still highlights a real cell instead of
    // silently selecting nothing.
    // No snapping. The wheel offers every minute, so the parser must
    // round-trip every minute — snapping here silently rewrote 9:17 to
    // 9:15 the moment the sheet reopened.
    minute: Math.min(59, Math.max(0, Number(m[2]))),
    meridiem: h24 < 12 ? "AM" : "PM",
  };
}

/** The grid's terms → the wire's "HH:mm". */
function toHHMM({ h12, minute, meridiem }) {
  const h24 = meridiem === "AM" ? h12 % 12 : (h12 % 12) + 12;
  return `${pad(h24)}:${pad(minute)}`;
}

/** "09:30" → "9:30 AM". Exported: callers display the same words the sheet does. */
export function formatHHMM(v) {
  const p = parseHHMM(v);
  if (!p) return "—";
  return `${p.h12}:${pad(p.minute)} ${p.meridiem}`;
}

/**
 * @param visible
 * @param value     "HH:mm" 24-hour, or null
 * @param onChange  (hhmm) => void — fired on Done
 * @param onClose
 * @param title
 */
export default function TimePickerSheet({
  visible,
  value,
  onChange,
  onClose,
  title = "Pick a time",
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  // 9:00 AM, not "now": the overwhelmingly common correction is a missed
  // morning punch, and starting at the shift's start is one tap from right.
  const [draft, setDraft] = useState(
    () => parseHHMM(value) || { h12: 9, minute: 0, meridiem: "AM" },
  );

  // Reopen on the value the caller holds, not on wherever the user last
  // browsed to — same rule as DatePickerSheet.
  useEffect(() => {
    if (!visible) return;
    setDraft(parseHHMM(value) || { h12: 9, minute: 0, meridiem: "AM" });
  }, [visible, value]);

  const set = (patch) => {
    tap();
    setDraft((d) => ({ ...d, ...patch }));
  };

  const headline = `${draft.h12}:${pad(draft.minute)} ${draft.meridiem}`;

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
          accessibilityLabel="Close time picker"
        />

        <Glass strong style={s.sheet}>
          <Text style={s.kicker}>{title}</Text>
          <Text style={s.headline}>{headline}</Text>

          {/* Three drums. Rolling is how a time gets set on a phone, and it
              is the same control on both platforms — unlike the OS pickers,
              which are a Material clock face on Android and a drum on iOS. */}
          <View style={s.wheels}>
            <Wheel
              testID="wheel-hour"
              items={HOURS_12.map((h) => ({ value: h, label: String(h) }))}
              value={draft.h12}
              onChange={(h12) => setDraft((d) => ({ ...d, h12 }))}
              width={ms(64)}
            />
            <Text style={s.colon}>:</Text>
            <Wheel
              testID="wheel-minute"
              items={MINUTES.map((m) => ({ value: m, label: pad(m) }))}
              value={draft.minute}
              onChange={(minute) => setDraft((d) => ({ ...d, minute }))}
              width={ms(64)}
            />
            <Wheel
              testID="wheel-meridiem"
              items={[
                { value: "AM", label: "AM" },
                { value: "PM", label: "PM" },
              ]}
              value={draft.meridiem}
              onChange={(meridiem) => setDraft((d) => ({ ...d, meridiem }))}
              width={ms(64)}
            />
          </View>

          <View style={s.actions}>
            <InlineAction label="Cancel" onPress={onClose} tone="textMuted" />
            <View style={{ flex: 1 }} />
            <InlineAction
              label="Now"
              onPress={() => {
                const n = new Date();
                const h = n.getHours();
                setDraft({
                  h12: h % 12 === 0 ? 12 : h % 12,
                  minute: n.getMinutes(),
                  meridiem: h < 12 ? "AM" : "PM",
                });
              }}
            />
          </View>

          <PrimaryAction
            label="Use this time"
            onPress={() => {
              onChange?.(toHHMM(draft));
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
      gap: ms(4),
    },
    colon: { ...type.headline, color: colors.textMuted, marginHorizontal: 2 },
    overlay: { flex: 1, justifyContent: "center", padding: spacing.loose },
    sheet: { borderRadius: radius.sheet, gap: spacing.tight },

    kicker: { ...type.caption, color: colors.textMuted },
    headline: { ...type.headline, color: colors.text, marginBottom: spacing.tight },

    groupLabel: { ...type.caption, color: colors.textFaint, letterSpacing: 0.6 },

    meridiem: {
      flexDirection: "row",
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      // `inset` — this control is a child of a panel, and repainting a panel
      // token inside a panel is the two-tone artifact. See Screen.js rule 3.
      backgroundColor: colors.inset,
      borderColor: colors.insetBorder,
      padding: 3,
      gap: 3,
      marginBottom: spacing.tight,
    },
    meridiemBtn: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 7,
      borderRadius: radius.control - 3,
    },
    meridiemText: { fontWeight: "600" },

    row: { flexDirection: "row" },
    cellWrap: { flex: 1, alignItems: "center", paddingVertical: 2 },
    cell: {
      width: ms(38),
      height: ms(34),
      borderRadius: radius.control,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1.5,
      borderColor: "transparent",
    },
    cellText: { ...type.body, color: colors.text },

    actions: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: spacing.tight,
    },
  });
