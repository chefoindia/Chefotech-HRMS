// src/components/ui/index.js
//
// The design system's public surface. Screens compose from these and from
// nothing else, so the theme, the layout and the press physics stay consistent
// everywhere.
//
// START HERE: `Screen` is the layout. Read the HOW TO BUILD A SCREEN block at
// the top of Screen.js before adding a page — it documents the four surface
// components, the child-of-a-panel rule, and why no screen ever sets a
// backgroundColor.

// ── The layout ────────────────────────────────────────────────────────────
export { default as Screen } from "./Screen";

// ── The ground ────────────────────────────────────────────────────────────
// Screen owns Aurora. Import it directly only to put the ground behind
// something that is not a Screen (the navigator does this for two legacy
// pages).
export { default as Aurora } from "./Aurora";
export { default as Gradient } from "./Gradient";

// ── Surfaces — the ONLY way to draw one ───────────────────────────────────
export { default as Glass } from "./Glass";
export { default as SlabCard } from "./SlabCard";
export { default as StatusTag, STATUS_LABELS } from "./StatusTag";
export { default as Figure, MetricCell } from "./Figure";

// ── Controls ──────────────────────────────────────────────────────────────
export {
  PrimaryAction,
  SecondaryAction,
  InlineAction,
  SegmentedToggle,
  LensToggle,
} from "./Controls";

// ── Chrome ────────────────────────────────────────────────────────────────
export { default as TopBar, ThemeToggle } from "./TopBar";
export { default as FloatingTabBar } from "./FloatingTabBar";
export { default as Avatar } from "./Avatar";
export { default as Calendar, resolveStatus, toneFor, workedMins, recentMonths } from "./Calendar";
export { default as DayDetail } from "./DayDetail";
export { default as DatePickerSheet } from "./DatePickerSheet";
export { default as TimePickerSheet, formatHHMM } from "./TimePickerSheet";

// Compatibility aliases for screens not yet migrated off the earlier names.
export { default as Field } from "./Field";
export { default as Band } from "./Band";
