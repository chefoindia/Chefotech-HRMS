// src/components/ui/StatusTag.js
//
// Small state markers. Tinted by meaning, and the tint is a faint mix of the
// tone into the surface beneath plus a matching border — a solid fill at this
// size reads as a button and invites a tap that does nothing.
//
// The fill is MIXED, not washed. It used to be `rgba(tone, 0.14)`, which is a
// translucent surface and therefore takes its final colour from whatever is
// painted underneath: the same tag rendered one colour on a panel, another on
// a `strong` panel, and a third if it ever landed directly on the aurora. Now
// the mix happens here, against a named surface, and the result is a finished
// colour — the same rule every other surface in the system follows. See the
// surface rule at the top of theme/palettes.js.

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme, radius, layout, type } from "../../theme";

// The stored status VALUES are not renamed — `hr_approved` is persisted on two
// collections, appears inside query predicates on the backend and drives the
// CMS filter tabs, so renaming it is a migration plus a synchronised
// three-repo deploy where every predicate that got missed fails silently.
//
// This map is the app's display layer, and it is the only place a status
// becomes words. So the wording is fixed HERE:
//
//   · "HR approved" was never true for an employee. On both leave and
//     regularization the final approver is the employee's own manager — HR
//     touches a request only when HR filed it. Someone reading "HR approved"
//     goes looking for an HR step that does not exist.
//   · "Manager approved" replaces "Under review" so a two-manager chain is
//     legible end to end: Waiting for manager → Manager approved → Request
//     approved. "Under review" said nothing about how far along it was.
//   · Every rejection reads "Not approved" regardless of who rejected it. Who
//     said no belongs in the detail view, not in a chip.
//
// The word "HR" must not appear in any employee-facing string. The CMS keeps
// saying "HR approved" — that surface genuinely IS HR, and this rename is
// deliberately app-only.
//
// Tones are unchanged: they are palette token names resolved against
// useTheme(), not colours.
export const STATUS_LABELS = {
  pending: { label: "Waiting for manager", tone: "warning" },
  manager_approved: { label: "Manager approved", tone: "accentAlt" },
  hr_approved: { label: "Request approved", tone: "success" },
  approved: { label: "Request approved", tone: "success" },
  rejected: { label: "Not approved", tone: "danger" },
  manager_rejected: { label: "Not approved", tone: "danger" },
  hr_rejected: { label: "Not approved", tone: "danger" },
  withdraw_pending: { label: "Withdraw requested", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "textFaint" },
  assigned: { label: "Assigned", tone: "accent" },
  in_progress: { label: "In progress", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  feedback_submitted: { label: "Feedback", tone: "accentAlt" },

  // HR-issued documents. The server collapses its two independent booleans
  // (generated / released) into one word before the row ever leaves the
  // backend, and these are those words.
  //
  // "available" must NOT read "HR released" — see the rule above: the word HR
  // is banned from an employee-facing chip. And "Ready to open" is what the
  // employee can actually DO, which is the only thing a chip this size has
  // room to say.
  //
  // "declined" reads "Not approved" like every other rejection in this map;
  // the reason HR wrote belongs in the row's caption, not in a chip.
  requested: { label: "Requested", tone: "warning" },
  available: { label: "Ready to open", tone: "success" },
  declined: { label: "Not approved", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "textMuted" },
  // `cancelled` is already registered above — documents reuse it as-is.
};

function rgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex));
  return m ? [m[1], m[2], m[3]].map((h) => parseInt(h, 16)) : null;
}

/**
 * Mix `amount` of `hex` into the opaque surface `over`, returning a finished
 * colour. This is what a translucent wash WOULD have resolved to, computed
 * once here instead of being left to the compositor to work out against
 * whatever happens to be behind the tag.
 *
 * Kept here rather than baked into the palette so any tone can be used as a
 * tag tint without adding a second "…Muted" token for every colour.
 */
function mix(hex, over, amount) {
  const a = rgb(hex);
  const b = rgb(over);
  if (!a || !b) return hex;
  const c = a.map((v, i) => Math.round(v * amount + b[i] * (1 - amount)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * @param on  the surface token this tag sits on. Defaults to "panel", which is
 *           where tags live in practice. Pass "inset" inside a recessed
 *           control, or "base" for a tag on the bare ground.
 */
export default function StatusTag({ status, label, tone, on = "panel", style }) {
  const { colors } = useTheme();
  const meta = STATUS_LABELS[status] || {};
  const text = label || meta.label || status || "—";
  const key = tone || meta.tone || "textMuted";
  const c = colors[key] || key;
  const ground = colors[on] || colors.panel;

  return (
    <View
      style={[
        styles.tag,
        { backgroundColor: mix(c, ground, 0.14), borderColor: mix(c, ground, 0.4) },
        style,
      ]}
    >
      <Text style={[type.caption, styles.text, { color: c }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    alignSelf: "flex-start",
    borderRadius: radius.tag,
    borderWidth: layout.hairlineWidth,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  text: { fontWeight: "500" },
});
