// src/constants/colors.js
export const Colors = {
  primary: "#111827",
  primaryLight: "#1f2937",
  background: "#F6F8FB",
  white: "#FFFFFF",
  card: "#FFFFFF",
  border: "#E5E7EB",
  borderLight: "#F3F4F6",
  text: "#111827",
  textSecondary: "#6B7280",
  textTertiary: "#9CA3AF",
  textMuted: "#D1D5DB",

  // Status colors
  emerald: { bg: "#DCFCE7", text: "#15803D", dot: "#10B981" },
  amber: { bg: "#FEF3C7", text: "#92400E", dot: "#F59E0B" },
  red: { bg: "#FEE2E2", text: "#B91C1C", dot: "#EF4444" },
  blue: { bg: "#DBEAFE", text: "#1D4ED8", dot: "#3B82F6" },
  indigo: { bg: "#EDE9FE", text: "#6D28D9", dot: "#6366F1" },
  purple: { bg: "#F3E8FF", text: "#7C3AED", dot: "#8B5CF6" },
  orange: { bg: "#FFEDD5", text: "#9A3412", dot: "#F97316" },
  gray: { bg: "#F3F4F6", text: "#6B7280", dot: "#9CA3AF" },
  yellow: { bg: "#FEF9C3", text: "#A16207", dot: "#EAB308" },
  teal: { bg: "#CCFBF1", text: "#0F766E", dot: "#14B8A6" },
  violet: { bg: "#EDE9FE", text: "#5B21B6", dot: "#7C3AED" },
  pink: { bg: "#FCE7F3", text: "#BE185D", dot: "#EC4899" },
  slate: { bg: "#F1F5F9", text: "#64748B", dot: "#94A3B8" },
};

// Attendance status map — used in timecard/attendance screens
export const STATUS_META = {
  P: { label: "Present", color: "emerald" },
  "P*": { label: "Present (Late)", color: "emerald" },
  "P~": { label: "Present (Early)", color: "emerald" },
  AB: { label: "Absent", color: "red" },
  LAB: { label: "Late → Absent", color: "red" }, // ← NEW
  LHD: { label: "Late → Half Day", color: "amber" }, // ← NEW
  EAB: { label: "Early → Absent", color: "red" }, // ← NEW
  WO: { label: "Week Off", color: "slate" },
  PH: { label: "Public Holiday", color: "amber" },
  FH: { label: "Festival Holiday", color: "amber" },
  NH: { label: "National Holiday", color: "amber" },
  OH: { label: "Optional Holiday", color: "amber" },
  RH: { label: "Restricted Holiday", color: "amber" },
  HD: { label: "Half Day", color: "yellow" },
  "L-CL": { label: "Casual Leave", color: "indigo" },
  "L-SL": { label: "Sick Leave", color: "orange" },
  "L-EL": { label: "Privilege Leave", color: "purple" },
  LWP: { label: "Unpaid Leave", color: "red" },
  MP: { label: "Miss Punch", color: "orange" },
  WFH: { label: "Work From Home", color: "blue" },
  CO: { label: "Comp. Off", color: "violet" },
};

// Leave type configurations
export const LEAVE_TYPES = [
  {
    key: "CL",
    label: "Casual Leave",
    color: "indigo",
    desc: "For personal errands & planned days off",
    supportsHalfDay: true,
  },
  {
    key: "SL",
    label: "Sick Leave",
    color: "amber",
    desc: "For illness or medical reasons",
    supportsHalfDay: true,
  },
  {
    key: "PL",
    label: "Privilege Leave",
    color: "emerald",
    desc: "Earned leave after qualifying period",
    supportsHalfDay: false,
  },
];

export const LEAVE_COLORS = {
  indigo: { bg: "#EEF2FF", text: "#4338CA", bar: "#6366F1", active: "#4F46E5" },
  amber: { bg: "#FFFBEB", text: "#B45309", bar: "#F59E0B", active: "#D97706" },
  emerald: {
    bg: "#ECFDF5",
    text: "#065F46",
    bar: "#10B981",
    active: "#059669",
  },
};

export const STATUS_MAP = {
  // ── Active states ──
  pending: { label: "Pending", bg: "#FEF3C7", text: "#92400E", dot: "#F59E0B" },
  manager_approved: {
    label: "Under Review",
    bg: "#DBEAFE",
    text: "#1D4ED8",
    dot: "#3B82F6",
  },
  hr_approved: {
    label: "Approved",
    bg: "#DCFCE7",
    text: "#15803D",
    dot: "#10B981",
  },
  approved: {
    label: "Approved",
    bg: "#DCFCE7",
    text: "#15803D",
    dot: "#10B981",
  }, // legacy alias

  // ── Rejected states ──
  rejected: {
    label: "Rejected",
    bg: "#FEE2E2",
    text: "#B91C1C",
    dot: "#EF4444",
  },
  manager_rejected: {
    label: "Not Approved",
    bg: "#FFEDD5",
    text: "#C2410C",
    dot: "#F97316",
  },
  hr_rejected: {
    label: "Rejected",
    bg: "#FEE2E2",
    text: "#B91C1C",
    dot: "#EF4444",
  },

  // ── Withdrawal states ──
  withdraw_pending: {
    label: "Withdraw Req.",
    bg: "#FEF3C7",
    text: "#92400E",
    dot: "#F97316",
  }, // ← NEW
  cancelled: {
    label: "Cancelled",
    bg: "#F3F4F6",
    text: "#6B7280",
    dot: "#9CA3AF",
  },
};

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
