// src/screens/LeaveScreen.js
//
// Leave: apply, track, and — for managers — approve.
//
// Migrated onto the shared layout system. Read the HOW TO BUILD A SCREEN block
// at the top of components/ui/Screen.js before editing this file: the frame,
// the gutter, the rhythm, the page head and the nav-pill clearance all belong
// to <Screen>, and this screen sets no background of its own anywhere.
//
// Nothing about the leave RULES changed in that migration. The two-step
// manager → HR approval, the quick-apply classification round trip, the
// CL/PL split arithmetic, the monthly and yearly caps, the Odisha variant of
// the monthly cap, the half-day handling and the withdrawal flow are the same
// code they were; only the surfaces they are drawn on moved.
//
// Two presentation conventions carry the whole file:
//
//   Well   — a child of a panel. Paints `colors.inset`, the ONLY surface token
//            a child may paint. Date strips, breakdown bars, reason boxes.
//   Frame  — a bordered group with NO fill. Used where the old design used a
//            grey card inside a white card; a fill there would be a surface
//            inside a surface, which is the artifact palettes.js exists to
//            prevent.
//
// Leave types no longer carry their own brand hex. They map onto the theme's
// semantic tones (see `leaveTone`), so they invert correctly in dark mode and
// stay legible against both decks.

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
  Modal,
  Pressable,
  ScrollView,
  Dimensions,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAuth } from "../context/AuthContext";
import { useBadges } from "../lib/badges";
import { getApiUrl } from "../lib/api";
import API_CONFIG from "../lib/api";
import {
  DatePickerSheet,
  Screen,
  Glass,
  StatusTag,
  Avatar,
  PrimaryAction,
  SecondaryAction,
  SegmentedToggle,
  InlineAction,
} from "../components/ui";
import { tap } from "../lib/feedback";
import { useTheme, radius, spacing, layout, type } from "../theme";

const { height: SH } = Dimensions.get("window");

// ─── Helpers ────────────────────────────────────────────────────────────────
const fmtDate = (s) => {
  if (!s) return "—";
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};
const toYMD = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseYMD = (s) => {
  if (!s) return new Date();
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const countDays = (f, t) => {
  if (!f || !t) return 0;
  return Math.max(1, Math.round((parseYMD(t) - parseYMD(f)) / 86400000) + 1);
};
/** Whole numbers print bare; halves print to one place. */
const num = (v) => (Number.isInteger(v) ? String(v) : Number(v).toFixed(1));

const LEAVE_LABELS = {
  CL: "Casual Leave",
  SL: "Sick Leave",
  PL: "Privilege Leave",
  LOP: "Loss of Pay",
};
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Leave type → theme tone.
 *
 * The old screen carried a LV_COLORS map of raw brand hexes (#6366F1 …) which
 * were tuned for a white card and went muddy on the dark deck. The meanings
 * map cleanly onto tones the palette already defines: casual is the neutral
 * default (ink/active), sick is a caution, privilege is earned, LOP is a loss.
 */
const leaveTone = (colors, t) =>
  ({
    CL: colors.accent,
    SL: colors.warning,
    PL: colors.success,
    LOP: colors.danger,
    QUICK: colors.warning,
  })[t] || colors.accent;

/** Shared theme + memoised stylesheet. */
function useUI() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  return { colors, s };
}

// ─── Surfaces a child of a panel is allowed to use ──────────────────────────

/** A recessed well on a panel. Paints `inset` — never a panel token. */
function Well({ children, style }) {
  const { s } = useUI();
  return <View style={[s.well, style]}>{children}</View>;
}

/** A bordered group with no fill, for content that must read as one block. */
function Frame({ children, style }) {
  const { s } = useUI();
  return <View style={[s.frame, style]}>{children}</View>;
}

// ─── Controls ───────────────────────────────────────────────────────────────

/** A compact action on a panel. Same `inset` material as SegmentedToggle. */
function Chip({ icon, label, onPress, disabled, style }) {
  const { s } = useUI();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        s.chip,
        disabled && s.dim,
        pressed && { opacity: 0.6 },
        style,
      ]}
    >
      {icon}
      <Text style={s.chipText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A bordered action carrying a semantic tone (reject, withdraw, classify). */
function ToneButton({
  label,
  icon,
  tone,
  onPress,
  disabled,
  loading,
  style,
}) {
  const { colors, s } = useUI();
  const t = tone || colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading }}
      disabled={disabled || loading}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        s.toneBtn,
        { borderColor: t },
        (disabled || loading) && s.dim,
        pressed && { opacity: 0.6 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={t} />
      ) : (
        <>
          {icon}
          <Text style={[type.title, { color: t }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

// ─── Sheet ──────────────────────────────────────────────────────────────────
//
// The themed replacement for SharedUI's BottomSheet, which paints a hardcoded
// white container and grey chrome. A modal has no ground behind it, so it is a
// top-level surface in its own right: <Glass strong>, exactly as the four-
// surface rule requires, squared off at the bottom and radiused at the top.
//
// The body's maxHeight lives on the ScrollView rather than the container so
// the sheet grows to its content and stops there — a maxHeight on the outer
// box alone leaves an unconstrained ScrollView, which collapses.
function Sheet({ visible, onClose, title, subtitle, icon, children }) {
  const { colors, s } = useUI();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={st.sheetOverlay}>
        {/* A scrim is a full-screen dimmer, not a surface — alpha is correct
            here and cannot split a region. */}
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
          onPress={onClose}
        />
        <Glass strong padded={false} style={s.sheet}>
          <View style={s.sheetHandle} />
          {title || subtitle ? (
            <View style={s.sheetHeader}>
              {icon ? <Well style={s.sheetIcon}>{icon}</Well> : null}
              <View style={st.flex}>
                {title ? (
                  <Text style={s.sheetTitle} numberOfLines={2}>
                    {title}
                  </Text>
                ) : null}
                {subtitle ? (
                  <Text style={s.sheetSubtitle}>{subtitle}</Text>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={onClose}
                style={s.sheetClose}
              >
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </Pressable>
            </View>
          ) : null}
          <ScrollView
            style={st.sheetBody}
            contentContainerStyle={st.sheetBodyContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </Glass>
      </View>
    </Modal>
  );
}

// ─── DateField ───────────────────────────────────────────────────────────────
function DateField({ label, value, onChange, minimumDate, placeholder }) {
  const { colors, s } = useUI();
  const [show, setShow] = useState(false);
  // minimumDate arrives as a Date from the callers; DatePickerSheet works in
  // ISO day strings, which is also what the form stores and the API expects.
  const minISO = minimumDate ? toYMD(minimumDate) : undefined;
  return (
    <View style={st.flex}>
      {label ? <Text style={s.formLabel}>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [s.dateBtn, pressed && { opacity: 0.7 }]}
        onPress={() => {
          tap();
          setShow(true);
        }}
      >
        <Ionicons
          name="calendar-outline"
          size={16}
          color={value ? colors.accent : colors.textFaint}
        />
        <Text
          style={[s.dateBtnText, !value && { color: colors.textFaint }]}
          numberOfLines={1}
        >
          {value ? fmtDate(value) : placeholder || "Select"}
        </Text>
      </Pressable>
      {/* One picker for both platforms. The OS widgets look nothing like
          each other or like this app, which is the whole reason this exists. */}
      <DatePickerSheet
        visible={show}
        value={value || null}
        onChange={(iso) => onChange(iso)}
        onClose={() => setShow(false)}
        title={label || "Pick a date"}
        minDate={minISO}
      />
    </View>
  );
}

// ─── SplitRow — value stays inline, never wraps ──────────────────────────────
function SplitRow({ label, sublabel, value, canAdd, onMinus, onPlus, first }) {
  const { colors, s } = useUI();
  const canSub = value > 0;
  const displayVal = num(value);
  return (
    <View style={[s.splitRow, !first && s.splitDivider]}>
      <View style={s.splitLabelWrap}>
        <Text style={s.splitLabel} numberOfLines={1}>
          {label}
        </Text>
        {sublabel ? (
          <Text style={s.splitSub} numberOfLines={1}>
            {sublabel}
          </Text>
        ) : null}
      </View>
      <View style={st.splitControls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
          onPress={() => {
            tap();
            onMinus?.();
          }}
          disabled={!canSub}
          style={({ pressed }) => [
            s.splitBtn,
            !canSub && s.dim,
            pressed && { opacity: 0.6 },
          ]}
        >
          <Text
            style={[
              s.splitBtnGlyph,
              { color: canSub ? colors.text : colors.textFaint },
            ]}
          >
            −
          </Text>
        </Pressable>
        {/* Fixed width so the value never reflows as it changes. */}
        <View style={st.splitValue}>
          <Text
            style={[
              s.splitNum,
              { color: value > 0 ? colors.text : colors.textFaint },
            ]}
            numberOfLines={1}
          >
            {displayVal}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
          onPress={() => {
            tap();
            onPlus?.();
          }}
          disabled={!canAdd}
          style={({ pressed }) => [
            s.splitBtn,
            !canAdd && s.dim,
            pressed && { opacity: 0.6 },
          ]}
        >
          <Text
            style={[
              s.splitBtnGlyph,
              { color: canAdd ? colors.text : colors.textFaint },
            ]}
          >
            +
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The auto-calculated LOP row that closes every split box. */
function LopRow({ label, note, value }) {
  const { colors, s } = useUI();
  return (
    <View style={[s.splitRow, s.splitDivider]}>
      <View style={s.splitLabelWrap}>
        <Text style={s.splitLabel}>{label}</Text>
        <Text style={s.splitSub}>{note}</Text>
      </View>
      <View style={st.splitValue}>
        <Text
          style={[
            s.splitNum,
            { color: value > 0 ? colors.danger : colors.textFaint },
          ]}
          numberOfLines={1}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

// ─── ApprovalCard ────────────────────────────────────────────────────────────
function ApprovalCard({ app, onApprove, onReject, onEdit, onClassify, busy }) {
  const { colors, s } = useUI();
  const [expanded, setExpanded] = useState(false);
  const tone = leaveTone(colors, app.leaveType);
  const days = app.totalDays || 1;
  const empName = app.employeeName || "—";
  const isQuick = app.leaveType === "QUICK" || app.isQuickApply;
  const needsClassify = isQuick && app.leaveType === "QUICK";

  return (
    <Glass style={[s.teamCard, { borderLeftColor: tone }]}>
      <View style={s.personRow}>
        <Avatar name={empName} size={42} />
        <View style={st.flex}>
          <Text style={s.personName} numberOfLines={1}>
            {empName}
          </Text>
          <Text style={s.personMeta} numberOfLines={1}>
            {app.department || ""}
          </Text>
        </View>
        <Well style={s.daysBadge}>
          <Text style={s.daysBadgeN}>
            {app.paidDays != null ? app.paidDays : days}
          </Text>
          <Text style={s.daysBadgeL}>{days === 1 ? "day" : "days"}</Text>
          {app.lwpDays > 0 && (
            <Text style={s.daysBadgeLop}>+{app.lwpDays} LOP</Text>
          )}
        </Well>
      </View>

      <View style={st.pillRow}>
        <StatusTag
          label={LEAVE_LABELS[app.leaveType] || app.leaveType}
          tone={tone}
        />
        {app.isHalfDay && <StatusTag label="Half day" tone="warning" />}
      </View>

      {app.paidDays != null && (
        <Well style={s.breakdownRow}>
          <Text style={s.breakdownPaid}>
            {app.paidDays} {app.leaveType} (Paid)
          </Text>
          <Text style={s.breakdownSep}>|</Text>
          <Text
            style={[
              s.breakdownLop,
              { color: app.lwpDays > 0 ? colors.danger : colors.success },
            ]}
          >
            {app.lwpDays || 0} LOP
          </Text>
        </Well>
      )}

      <Well style={s.datesRow}>
        <View>
          <Text style={s.dateLbl}>From</Text>
          <Text style={s.dateVal}>{fmtDate(app.fromDate)}</Text>
        </View>
        <Ionicons name="arrow-forward" size={14} color={colors.textFaint} />
        <View style={st.alignEnd}>
          <Text style={s.dateLbl}>To</Text>
          <Text style={s.dateVal}>{fmtDate(app.toDate)}</Text>
        </View>
      </Well>

      {app.reason ? (
        <InlineAction
          label={expanded ? "Hide" : "Show reason"}
          onPress={() => setExpanded(!expanded)}
          style={s.reasonToggle}
        />
      ) : null}
      {expanded && app.reason ? (
        <Well style={[s.reasonBox, { borderLeftColor: colors.accent }]}>
          <Text style={s.reasonText}>{app.reason}</Text>
        </Well>
      ) : null}

      {needsClassify ? (
        <Well style={s.noticeBox}>
          <Text style={[s.noticeTitle, { color: colors.warning }]}>
            Quick apply — pick the leave type
          </Text>
          <Text style={s.noticeBody}>
            {app.isHalfDay ? "Half day" : "Full day"} on {fmtDate(app.fromDate)}
          </Text>
        </Well>
      ) : null}

      {!needsClassify ? (
        <SecondaryAction
          label="Edit Leave"
          icon={
            <Ionicons name="create-outline" size={14} color={colors.text} />
          }
          onPress={() => onEdit(app)}
          style={s.editBtn}
        />
      ) : null}

      <View style={st.actionRow}>
        <ToneButton
          label="Reject"
          tone={colors.danger}
          icon={
            <Ionicons
              name="thumbs-down-outline"
              size={14}
              color={colors.danger}
            />
          }
          disabled={!!busy}
          onPress={() => onReject(app)}
          style={st.flex}
        />
        {needsClassify ? (
          <PrimaryAction
            label="Classify"
            loading={!!busy}
            disabled={!!busy}
            icon={
              <Ionicons
                name="pricetag-outline"
                size={14}
                color={colors.onHero}
              />
            }
            onPress={() => onClassify(app)}
            style={st.flex}
          />
        ) : (
          <PrimaryAction
            label="Approve"
            loading={!!busy}
            disabled={!!busy}
            icon={
              <Ionicons
                name="thumbs-up-outline"
                size={14}
                color={colors.onHero}
              />
            }
            onPress={() =>
              Alert.alert("Approve", `Approve ${empName}'s leave?`, [
                { text: "Cancel", style: "cancel" },
                { text: "Approve", onPress: () => onApprove(app._id, "") },
              ])
            }
            style={st.flex}
          />
        )}
      </View>
    </Glass>
  );
}

// ─── LeaveTypeSelector ───────────────────────────────────────────────────────
function LeaveTypeSelector({ value, onChange, availCL, availSL, availPL, eligPL }) {
  const { colors, s } = useUI();
  const types = [
    { key: "CL", label: "Casual", avail: availCL },
    { key: "SL", label: "Sick", avail: availSL },
    ...(eligPL ? [{ key: "PL", label: "Privilege", avail: availPL }] : []),
    { key: "LOP", label: "LOP", avail: null },
  ];
  return (
    <View>
      <Text style={s.formLabel}>LEAVE TYPE</Text>
      <View style={st.typeWrap}>
        {types.map((t) => {
          const active = value === t.key;
          const tone = leaveTone(colors, t.key);
          const displayAvail = t.avail != null ? num(t.avail) : null;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => {
                tap();
                onChange(t.key);
              }}
              style={({ pressed }) => [
                s.typeChip,
                active && { borderColor: tone, borderWidth: 1.5 },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text
                style={[
                  s.typeChipKey,
                  { color: active ? tone : colors.textMuted },
                ]}
              >
                {t.key}
              </Text>
              <Text
                style={[
                  s.typeChipMeta,
                  { color: active ? tone : colors.textFaint },
                ]}
                numberOfLines={1}
              >
                {displayAvail != null ? `${displayAvail} left` : t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── One row in a list of applications ──────────────────────────────────────
function AppRow({ app, onPress, first, showClassifier }) {
  const { colors, s } = useUI();
  const tone = leaveTone(colors, app.leaveType);
  const shownDays = app.paidDays != null ? num(app.paidDays) : app.totalDays;
  return (
    <Glass.Row first={first} onPress={() => onPress(app)} style={s.rowPad}>
      <View style={[s.typeDot, { backgroundColor: tone }]} />
      <View style={st.flex}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {LEAVE_LABELS[app.leaveType] || app.leaveType}
        </Text>
        {showClassifier && app.isQuickApply && app.quickApply?.resolvedByName ? (
          <Text style={s.rowClassifier} numberOfLines={1}>
            Classified by {app.quickApply.resolvedByName}
          </Text>
        ) : null}
        <Text style={s.rowDates} numberOfLines={1}>
          {fmtDate(app.fromDate)}
          {app.toDate && app.toDate !== app.fromDate
            ? ` → ${fmtDate(app.toDate)}`
            : ""}
        </Text>
        <View style={st.rowMetaLine}>
          <Text style={s.rowDays}>
            {shownDays} day{(app.paidDays ?? app.totalDays) !== 1 ? "s" : ""}
          </Text>
          {app.lwpDays > 0 && (
            <StatusTag label={`+${app.lwpDays} LWP`} tone="danger" />
          )}
        </View>
      </View>
      <StatusTag status={app.status} />
    </Glass.Row>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  MAIN SCREEN
// ════════════════════════════════════════════════════════════════════════════
export default function LeaveScreen() {
  const { user, apiFetch } = useAuth();
  const { refreshBadges } = useBadges();
  const { colors, s } = useUI();
  const [apps, setApps] = useState([]);
  const [balance, setBalance] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all");
  const [showApply, setShowApply] = useState(false);
  const [selectedApp, setSelectedApp] = useState(null);
  const [toast, setToast] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState({
    leaveType: "CL",
    fromDate: "",
    toDate: "",
    reason: "",
    isHalfDay: false,
    halfDaySlot: "first_half",
  });
  const [applyLoading, setApplyLoading] = useState(false);
  const [mainSection, setMainSection] = useState("my");
  const [isManager, setIsManager] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [busyId, setBusyId] = useState(null);
  // Balance is year-only now: the month view repeated what the year view
  // already showed, and CL's monthly cap is surfaced on the apply form, which
  // is the only place it changes a decision.
  const [split, setSplit] = useState({ CL: 0, PL: 0 });
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({
    fromDate: "",
    toDate: "",
    reason: "",
  });
  const [editSplit, setEditSplit] = useState({ CL: 0, PL: 0 });
  const [editLoading, setEditLoading] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectLoading, setRejectLoading] = useState(false);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  // ── Quick-apply classify state (secondary manager picks CL / SL / LOP) ──
  const [classifyTarget, setClassifyTarget] = useState(null);
  const [classifyLoading, setClassifyLoading] = useState(false);
  const [classifyForceReason, setClassifyForceReason] = useState("");
  const [classifyForceFor, setClassifyForceFor] = useState(null); // "LOP" when force-reason input is visible
  const [historyApp, setHistoryApp] = useState(null);
  const [teamHistoryApp, setTeamHistoryApp] = useState(null);
  const [showTeamHistory, setShowTeamHistory] = useState(false);
  const [teamHistory, setTeamHistory] = useState([]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  // ── Config-derived values ──
  const slThreshold = config?.slDocumentThreshold ?? 2;
  const maxCLPerMonth = config?.maxCLPerMonth || 3;
  const clPerYear = config?.clPerYear || 12;
  const slPerYear = config?.slPerYear || 6;
  const plPerYear = config?.plPerYear || 18;
  const empState = (
    user?.address?.current?.state ||
    user?.address?.permanent?.state ||
    ""
  )
    .toLowerCase()
    .trim();
  const isOdisha = ["odisha", "orissa"].includes(empState);
  const monthlyCap = isOdisha
    ? config?.maxLeaveDaysPerMonthOdisha || 7
    : config?.maxLeaveDaysPerMonth || 10;

  const applyDays = form.isHalfDay
    ? 0.5
    : countDays(form.fromDate, form.toDate || form.fromDate);

  // ── Monthly usage from existing apps ──
  const monthlyUsage = useMemo(() => {
    const now = new Date();
    const cm = now.getMonth() + 1,
      cy = now.getFullYear();
    const ms = String(cm).padStart(2, "0");
    const mS = `${cy}-${ms}-01`,
      mE = `${cy}-${ms}-${new Date(cy, cm, 0).getDate()}`;
    const u = { CL: 0, SL: 0, PL: 0 };
    for (const a of apps) {
      if (!["pending", "manager_approved", "hr_approved"].includes(a.status))
        continue;
      if (!a.fromDate || !a.toDate || a.toDate < mS || a.fromDate > mE)
        continue;
      const d = a.isHalfDay
        ? 0.5
        : countDays(
            a.fromDate > mS ? a.fromDate : mS,
            a.toDate < mE ? a.toDate : mE,
          );
      if (u[a.leaveType] !== undefined) u[a.leaveType] += d;
    }
    return {
      ...u,
      total: u.CL + u.SL + u.PL,
      monthLabel: `${MONTHS[cm - 1]} ${cy}`,
    };
  }, [apps]);

  // ── Yearly usage ──
  const yearlyUsage = useMemo(() => {
    const cy = new Date().getFullYear();
    const u = { CL: 0, SL: 0, PL: 0 };
    for (const a of apps) {
      if (!["pending", "manager_approved", "hr_approved"].includes(a.status))
        continue;
      const y = a.fromDate ? parseInt(a.fromDate.split("-")[0]) : 0;
      if (y !== cy) continue;
      if (u[a.leaveType] !== undefined)
        u[a.leaveType] += a.isHalfDay ? 0.5 : a.totalDays || 0;
    }
    return u;
  }, [apps]);

  const avail = balance?.available || {};
  const elig = balance?.eligibility || {};
  const entitlement = balance?.entitlement || {};
  const consumed = balance?.consumed || {};

  // `available` is entitlement minus what has actually been APPROVED. Days that
  // are only requested still sit in it, so a fresh application appeared to cost
  // nothing until a manager acted — the balance card and the apply-form caps
  // both read the same, stale, too-generous number.
  //
  // `reserved` is those requested-but-undecided days (pending +
  // manager_approved), derived server-side per read; `effectiveAvailable` is
  // available minus reserved. Neither is stored, so nothing here has to be
  // refunded when a request is rejected, cancelled or deleted.
  //
  // The fallback to `available` is load-bearing: a build of this app can be
  // installed against a backend that has not shipped the two new keys yet, and
  // in that case the old (looser) numbers are still the correct answer.
  const reserved = balance?.reserved || {};
  const effAvail = balance?.effectiveAvailable || balance?.available || {};

  // ── maxCL properly capped by BOTH monthly limit AND yearly balance ──
  const monthlyRemaining = Math.max(0, monthlyCap - (monthlyUsage.total || 0));
  const clMonthlyRemaining = Math.max(
    0,
    maxCLPerMonth - (monthlyUsage.CL || 0),
  );
  //
  // The yearly axis uses `effAvail` (balance minus days already requested); the
  // monthly axis keeps using monthlyUsage, which ALREADY counts pending and
  // manager_approved applications (see the status filter in monthlyUsage
  // above). Subtracting the reserve on both would charge the same request
  // twice.
  const maxCL = Math.min(
    effAvail.CL || 0, // what's left in annual balance, less pending requests
    clMonthlyRemaining, // what's left this month for CL
    monthlyRemaining, // what's left this month total
  );
  const maxSL = effAvail.SL || 0;
  const maxPL = elig.plComplete
    ? Math.min(effAvail.PL || 0, monthlyRemaining)
    : 0;

  const usedPaid = split.CL + split.PL;
  const lop = Math.max(0, applyDays - usedPaid);
  const primaryType = split.CL >= split.PL ? "CL" : "PL";
  const isDirectLeave = form.leaveType === "SL" || form.leaveType === "LOP";

  // Edit computed
  const editDays = editTarget
    ? countDays(editForm.fromDate, editForm.toDate)
    : 0;
  const editMgrType =
    editTarget?.managersNotified?.find(
      (m) => String(m.managerId) === String(user?._id || user?.id),
    )?.type || "primary";
  const isSecondaryMgr = editMgrType === "secondary";
  // editMaxCL capped to employee's actual CL balance for that month, not hardcoded 3
  const editOriginalPaid = editTarget
    ? (editTarget.paidDays ?? editTarget.totalDays)
    : 0;
  const editMaxCL = editTarget
    ? Math.min(maxCLPerMonth, editOriginalPaid)
    : maxCLPerMonth;
  const editMaxPL =
    isSecondaryMgr && editTarget?.leaveType === "PL"
      ? Math.min(avail.PL || 0, editOriginalPaid)
      : 0;
  const editUsed = editSplit.CL + editSplit.PL;
  const editLop = Math.max(0, editDays - editUsed);
  const editPrimaryType = editSplit.CL >= editSplit.PL ? "CL" : "PL";

  // ── Reset split on type/date change ──
  useEffect(() => {
    if (form.leaveType === "CL" || form.leaveType === "PL") {
      if (applyDays > 0) {
        if (form.leaveType === "CL")
          setSplit({ CL: Math.min(applyDays, maxCL), PL: 0 });
        else setSplit({ CL: 0, PL: Math.min(applyDays, maxPL) });
      } else setSplit({ CL: 0, PL: 0 });
    }
  }, [applyDays, maxCL, maxPL, form.leaveType]);

  useEffect(() => {
    if (editDays > 0) {
      const ac = Math.min(editDays, editMaxCL);
      setEditSplit({
        CL: ac,
        PL: Math.min(Math.max(0, editDays - ac), editMaxPL),
      });
    } else setEditSplit({ CL: 0, PL: 0 });
  }, [editDays, editMaxCL, editMaxPL]);

  const adjustSplit = (type, delta) => {
    setSplit((p) => {
      const cap = type === "CL" ? maxCL : maxPL;
      const nv = Math.max(0, Math.min(p[type] + delta, cap, applyDays));
      const ns = { ...p, [type]: nv };
      if (ns.CL + ns.PL > applyDays)
        ns[type === "CL" ? "PL" : "CL"] = Math.max(0, applyDays - nv);
      return ns;
    });
  };
  const adjustEditSplit = (type, delta) => {
    setEditSplit((p) => {
      const cap = type === "CL" ? editMaxCL : editMaxPL;
      const nv = Math.max(0, Math.min(p[type] + delta, cap, editDays));
      const ns = { ...p, [type]: nv };
      if (ns.CL + ns.PL > editDays)
        ns[type === "CL" ? "PL" : "CL"] = Math.max(0, editDays - nv);
      return ns;
    });
  };

  // ── Fetch ──
  const fetchAll = useCallback(async () => {
    try {
      const [a, b, c, t, p] = await Promise.allSettled([
        apiFetch(getApiUrl(API_CONFIG.endpoints.leave.list)),
        apiFetch(getApiUrl(API_CONFIG.endpoints.leave.balance)),
        apiFetch(getApiUrl(API_CONFIG.endpoints.leave.config)),
        apiFetch(getApiUrl("/leave-applications/manager/my-team")),
        apiFetch(getApiUrl(API_CONFIG.endpoints.leave.managerPending)),
      ]);
      if (a.status === "fulfilled" && a.value.success)
        setApps(a.value.data || []);
      if (b.status === "fulfilled" && b.value.success) setBalance(b.value.data);
      if (c.status === "fulfilled" && c.value.success) setConfig(c.value.data);
      if (t.status === "fulfilled" && t.value.success)
        setIsManager((t.value.data || []).length > 0);
      if (p.status === "fulfilled" && p.value.success)
        setPendingApprovals(p.value.data || []);
    } catch (_) {
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const fetchTeamHistory = useCallback(async () => {
    try {
      const res = await apiFetch(
        getApiUrl("/leave-applications/manager/history"),
      );
      if (res.success) setTeamHistory(res.data || []);
    } catch (_) {}
  }, [apiFetch]);

  // Fetch withdrawal requests pending manager approval
  const [withdrawRequests, setWithdrawRequests] = useState([]);
  const fetchWithdrawRequests = useCallback(async () => {
    try {
      const res = await apiFetch(
        getApiUrl("/leave-applications/manager/withdraw-pending"),
      );
      if (res.success) setWithdrawRequests(res.data || []);
    } catch (_) {}
  }, [apiFetch]);

  useEffect(() => {
    if (isManager) fetchWithdrawRequests();
  }, [isManager, fetchWithdrawRequests]);

  useEffect(() => {
    if (isManager) fetchTeamHistory();
  }, [isManager, fetchTeamHistory]);

  // ── Apply ──
  const handleApply = async () => {
    if (!form.fromDate || !form.reason.trim()) {
      Alert.alert("Required", "Select dates and enter a reason");
      return;
    }
    if (form.leaveType === "SL" && applyDays > slThreshold) {
      Alert.alert(
        "Medical Certificate Required",
        `Sick leave beyond ${slThreshold} days requires a medical certificate.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Proceed Anyway", onPress: () => submitLeave() },
        ],
      );
      return;
    }
    if (form.leaveType === "LOP") {
      Alert.alert(
        "Loss of Pay Leave",
        `All ${applyDays} day(s) will be unpaid. Proceed?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Yes, Apply as LOP", onPress: () => submitLeave() },
        ],
      );
      return;
    }
    submitLeave();
  };

  const submitLeave = async () => {
    setApplyLoading(true);
    try {
      let payload;
      if (form.leaveType === "SL") {
        payload = {
          leaveType: "SL",
          applicationDate: toYMD(new Date()),
          fromDate: form.fromDate,
          toDate: form.isHalfDay ? form.fromDate : form.toDate || form.fromDate,
          reason: form.reason,
          isHalfDay: form.isHalfDay,
          halfDaySlot: form.isHalfDay ? form.halfDaySlot : undefined,
        };
      } else if (form.leaveType === "LOP") {
        payload = {
          leaveType: "LOP",
          applicationDate: toYMD(new Date()),
          fromDate: form.fromDate,
          toDate: form.isHalfDay ? form.fromDate : form.toDate || form.fromDate,
          reason: form.reason,
          isHalfDay: form.isHalfDay,
          paidDays: 0,
        };
      } else {
        payload = {
          leaveType: primaryType,
          applicationDate: toYMD(new Date()),
          fromDate: form.fromDate,
          toDate: form.isHalfDay ? form.fromDate : form.toDate || form.fromDate,
          reason: form.reason,
          isHalfDay: form.isHalfDay,
        };
      }
      const res = await apiFetch(getApiUrl(API_CONFIG.endpoints.leave.list), {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const bk = res.breakdown;
      showToast(
        bk?.lwpDays > 0
          ? `${bk.paidDays} ${bk.leaveType || form.leaveType} (paid) + ${bk.lwpDays} LWP`
          : form.leaveType === "LOP"
            ? `LOP applied — ${applyDays} day(s) unpaid`
            : res.message || "Leave submitted!",
      );
      setShowApply(false);
      setForm({
        leaveType: "CL",
        fromDate: "",
        toDate: "",
        reason: "",
        isHalfDay: false,
        halfDaySlot: "first_half",
      });
      setSplit({ CL: 0, PL: 0 });
      fetchAll();
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setApplyLoading(false);
    }
  };

  // ── QUICK-APPLY ─────────────────────────────────────────────────────
  // Tapping a shortcut button skips the leave-type picker. The application
  // goes to the PRIMARY manager as leaveType="QUICK". They classify it as
  // CL/SL/LOP via /leave-applications/quick-apply/:id/resolve, then the
  // SECONDARY manager approves. Final status: hr_approved. (Same primary→
  // secondary order as the regular leave flow.)
  const sendQuickApply = async ({
    isHalfDay,
    halfDaySlot,
    reason,
    targetDate,
  }) => {
    setApplyLoading(true);
    try {
      const res = await apiFetch(getApiUrl("/leave-applications/quick-apply"), {
        method: "POST",
        body: JSON.stringify({
          isHalfDay,
          halfDaySlot: isHalfDay ? halfDaySlot : undefined,
          reason,
          targetDate: targetDate || "today",
        }),
      });
      showToast(res.message || "Leave request sent for classification");
      fetchAll();
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setApplyLoading(false);
    }
  };

  const submitQuickApply = ({ isHalfDay, halfDaySlot, targetDate }) => {
    // Cross-platform prompt. Alert.prompt is iOS-only; on Android we fall
    // back to a default reason. Replace the Android branch with your in-app
    // prompt component when you have one.
    const dayLabel = targetDate === "tomorrow" ? "Tomorrow" : "Today";
    const title = isHalfDay
      ? `Half-Day Leave ${dayLabel}`
      : `Full-Day Leave ${dayLabel}`;
    const body =
      "Briefly describe the reason. Your manager will classify it as CL / SL / LOP.";

    if (Platform.OS === "ios" && Alert.prompt) {
      Alert.prompt(
        title,
        body,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Submit",
            onPress: (reason) => {
              if (!reason || !reason.trim()) {
                Alert.alert("Required", "Please enter a reason");
                return;
              }
              sendQuickApply({
                isHalfDay,
                halfDaySlot,
                reason: reason.trim(),
                targetDate,
              });
            },
          },
        ],
        "plain-text",
      );
    } else {
      Alert.alert(
        title,
        `${body}\n\nReason will be saved as "Personal — quick apply".`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Submit",
            onPress: () =>
              sendQuickApply({
                isHalfDay,
                halfDaySlot,
                reason: "Personal — quick apply",
                targetDate,
              }),
          },
        ],
      );
    }
  };

  // ── WITHDRAW — sends request to managers ──
  const handleWithdraw = async (app) => {
    const isApproved = app.status === "hr_approved";
    Alert.alert(
      isApproved ? "Request Withdrawal" : "Withdraw Leave",
      isApproved
        ? `This will send a withdrawal request to your manager. They must approve before the leave is cancelled. Proceed?`
        : `Withdraw your ${LEAVE_LABELS[app.leaveType]} application (${fmtDate(app.fromDate)}${app.toDate !== app.fromDate ? ` – ${fmtDate(app.toDate)}` : ""})? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: async () => {
            setWithdrawLoading(true);
            try {
              // For pending/manager_approved: direct cancel
              // For hr_approved: send withdrawal request (cancel with reason)
              const endpoint = ["pending", "manager_approved"].includes(
                app.status,
              )
                ? `/leave-applications/${app._id}/cancel`
                : `/leave-applications/${app._id}/cancel`;
              await apiFetch(getApiUrl(endpoint), {
                method: "PATCH",
                body: JSON.stringify({
                  cancelReason: "Employee withdrawal request",
                }),
              });
              showToast("Withdrawal request sent");
              setSelectedApp(null);
              fetchAll();
            } catch (e) {
              Alert.alert("Error", e.message);
            } finally {
              setWithdrawLoading(false);
            }
          },
        },
      ],
    );
  };

  const handleEditSave = async () => {
    if (!editForm.fromDate || !editForm.toDate || !editForm.reason.trim()) {
      Alert.alert("Required", "Fill all fields");
      return;
    }
    setEditLoading(true);
    try {
      await apiFetch(
        getApiUrl(`/leave-applications/manager/${editTarget._id}/edit`),
        {
          method: "PUT",
          body: JSON.stringify({
            fromDate: editForm.fromDate,
            toDate: editForm.toDate,
            leaveType: isSecondaryMgr ? editPrimaryType : editTarget.leaveType,
            reason: editForm.reason,
            ...(isSecondaryMgr
              ? { paidDays: editSplit.CL + editSplit.PL }
              : {}),
          }),
        },
      );
      showToast("Leave updated");
      setEditTarget(null);
      fetchAll();
    } catch (e) {
      Alert.alert("Error", e.message);
    } finally {
      setEditLoading(false);
    }
  };

  /**
   * OPTIMISTIC. The row leaves the list on tap; the request follows.
   *
   * This used to await the PATCH and then await TWO full refetches before
   * anything moved — three sequential round trips on a phone, which is the
   * pause you feel after pressing Approve. The decision is already made at the
   * moment of the tap, so the UI can act on it and reconcile afterwards.
   *
   * On failure the row is put back exactly where it was and the error is
   * shown, so an optimistic update can never silently swallow a rejection
   * from the server.
   */
  const handleApprove = async (id, remarks) => {
    const snapshot = pendingApprovals;
    setPendingApprovals((list) => list.filter((a) => a._id !== id));
    showToast("Approved ✓");

    try {
      await apiFetch(getApiUrl(`/leave-applications/manager/${id}/approve`), {
        method: "PATCH",
        body: JSON.stringify({ remarks }),
      });
      // Reconcile in the background — the user is already looking at the
      // updated list and does not wait on this.
      Promise.all([fetchAll(), fetchTeamHistory()]).catch(() => {});
      refreshBadges?.();
    } catch (e) {
      setPendingApprovals(snapshot);
      Alert.alert("Could not approve", e.message);
    }
  };

  const handleRejectConfirm = async () => {
    if (!rejectReason.trim()) {
      Alert.alert("Required", "Enter rejection reason");
      return;
    }
    // Same optimistic shape as approve: close the sheet and drop the row now,
    // reconcile after.
    const id = rejectTarget._id;
    const reason = rejectReason;
    const snapshot = pendingApprovals;

    setPendingApprovals((list) => list.filter((a) => a._id !== id));
    setRejectTarget(null);
    setRejectReason("");
    showToast("Rejected");

    try {
      await apiFetch(getApiUrl(`/leave-applications/manager/${id}/reject`), {
        method: "PATCH",
        body: JSON.stringify({ remarks: reason }),
      });
      Promise.all([fetchAll(), fetchTeamHistory()]).catch(() => {});
      refreshBadges?.();
    } catch (e) {
      setPendingApprovals(snapshot);
      Alert.alert("Could not reject", e.message);
    }
  };

  // ── Classify a quick-apply leave (primary manager) ──
  // Picks CL / SL / LOP for a "QUICK" pending leave. Backend validates
  // balance and monthly CL cap. If backend says "employee has CL/SL balance,
  // forceLOPReason required", we surface a small input and resubmit.
  const handleResolveQuick = async (resolvedType, forceLOPReason) => {
    if (!classifyTarget?._id) return;
    setClassifyLoading(true);
    try {
      const body = { resolvedType };
      if (forceLOPReason && forceLOPReason.trim())
        body.forceLOPReason = forceLOPReason.trim();
      const res = await apiFetch(
        getApiUrl(
          `/leave-applications/quick-apply/${classifyTarget._id}/resolve`,
        ),
        { method: "PATCH", body: JSON.stringify(body) },
      );
      showToast(res.message || `Classified as ${resolvedType}`);
      setClassifyTarget(null);
      setClassifyForceReason("");
      setClassifyForceFor(null);
      await Promise.all([fetchAll(), fetchTeamHistory()]);
    } catch (e) {
      // apiFetch throws a plain Error with just .message, so we detect the
      // "forceLOPReason required" case by pattern-matching the message.
      // The backend phrasing is distinctive enough that this won't false-match.
      const msg = e?.message || "Could not classify leave";
      const isForceLopCase =
        resolvedType === "LOP" &&
        /forceLOPReason|CL\/SL balance available/i.test(msg);
      if (isForceLopCase) {
        // Reveal the reason input. Don't show an alert — let the new input
        // field do the talking. The user types a reason and taps LOP again.
        setClassifyForceFor("LOP");
      } else {
        Alert.alert("Cannot classify", msg);
      }
    } finally {
      setClassifyLoading(false);
    }
  };

  // ── Filtered lists ──
  const filtered =
    tab === "all"
      ? apps
      : apps.filter((a) => {
          if (tab === "pending")
            return ["pending", "manager_approved", "withdraw_pending"].includes(
              a.status,
            );
          if (tab === "approved") return a.status === "hr_approved";
          if (tab === "rejected")
            return [
              "rejected",
              "hr_rejected",
              "manager_rejected",
              "cancelled",
            ].includes(a.status);
          return true;
        });

  // Approved history (for history section)
  const approvedHistory = apps
    .filter((a) => a.status === "hr_approved")
    .sort((a, b) => (b.fromDate > a.fromDate ? 1 : -1));

  const onRefresh = () => {
    setRefreshing(true);
    fetchAll().then(() => setRefreshing(false));
  };

  if (loading)
    return (
      <Screen title="Leave" subtitle="Apply and track your leaves">
        <Glass>
          <ActivityIndicator size="large" color={colors.accent} />
        </Glass>
      </Screen>
    );

  return (
    <Screen
      title="Leave"
      subtitle="Apply and track your leaves"
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={
        toast ? (
          <Glass strong padded={false} style={st.toast}>
            <View style={st.toastRow}>
              <Ionicons
                name="checkmark-circle"
                size={18}
                color={colors.success}
              />
              <Text style={s.toastText}>{toast}</Text>
            </View>
          </Glass>
        ) : null
      }
    >
      {/* ── Apply + quick-apply shortcuts ── */}
      <Glass label="Apply">
        <PrimaryAction
          label="Apply for leave"
          icon={<Ionicons name="add" size={18} color={colors.onHero} />}
          onPress={() => setShowApply(true)}
        />
        <View style={st.quickWrap}>
          <Chip
            label="Full Day Today"
            disabled={applyLoading}
            icon={
              <Ionicons
                name="calendar-outline"
                size={16}
                color={colors.text}
              />
            }
            onPress={() =>
              submitQuickApply({
                isHalfDay: false,
                halfDaySlot: null,
                targetDate: "today",
              })
            }
          />
          <Chip
            label="Half Day Today"
            disabled={applyLoading}
            icon={
              <Ionicons name="time-outline" size={16} color={colors.text} />
            }
            onPress={() =>
              submitQuickApply({
                isHalfDay: true,
                halfDaySlot: "first_half",
                targetDate: "today",
              })
            }
          />
          <Chip
            label="Full Day Tomorrow"
            disabled={applyLoading}
            icon={
              <Ionicons
                name="arrow-forward-outline"
                size={16}
                color={colors.text}
              />
            }
            onPress={() =>
              submitQuickApply({
                isHalfDay: false,
                halfDaySlot: null,
                targetDate: "tomorrow",
              })
            }
          />
        </View>
        <Text style={s.hint}>
          Manager picks Casual / Sick / LOP after you submit.
        </Text>
      </Glass>

      {/* ── Manager / My toggle ── */}
      {isManager && (
        <SegmentedToggle
          value={mainSection}
          onChange={setMainSection}
          options={[
            { value: "my", label: "My Leaves" },
            {
              value: "team",
              label: pendingApprovals.length
                ? `Team · ${pendingApprovals.length}`
                : "Team",
            },
          ]}
        />
      )}

      {/* ══ MY LEAVES ══ */}
      {mainSection === "my" && (
        <>
          <Glass label="Leave balance">
            {(
              <View style={st.balRow}>
                {["CL", "SL", "PL"].map((t) => {
                  const used = consumed[t] || 0,
                    total = entitlement[t] || 0,
                    held = reserved[t] || 0,
                    // The headline figure is what the employee can still
                    // ACTUALLY apply for. Showing the pre-reserve number here
                    // was the whole complaint: apply for three days, and the
                    // card carried on claiming you had them.
                    av = effAvail[t] || 0;
                  const tone = leaveTone(colors, t),
                    // The bar fills for everything spoken for — taken AND
                    // requested — so it agrees with the number above it.
                    pct = total > 0 ? ((total - av) / total) * 100 : 0;
                  return (
                    <View key={t} style={st.balCell}>
                      <Text style={[s.balType, { color: tone }]}>{t}</Text>
                      <Text style={s.balAvail}>{num(av)}</Text>
                      <Text style={s.balOfTotal}>of {total}</Text>
                      <View style={s.balBar}>
                        <View
                          style={[
                            st.balBarFill,
                            {
                              width: `${Math.min(pct, 100)}%`,
                              backgroundColor: tone,
                            },
                          ]}
                        />
                      </View>
                      {/* Two different things are missing from the headline
                          number, and they are not the same thing: `used` is
                          gone for good, `pending` comes back if the request is
                          turned down. Name both — but only when something IS
                          pending, so a normal balance reads exactly as before. */}
                      {held > 0 ? (
                        <Text style={[s.balUsed, { color: colors.textMuted }]}>
                          {num(used)} used · {num(held)} pending
                        </Text>
                      ) : (
                        <Text
                          style={[
                            s.balUsed,
                            { color: used > 0 ? tone : colors.textFaint },
                          ]}
                        >
                          {num(used)} used
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </Glass>

          {/* Filter tabs */}
          <SegmentedToggle
            value={tab}
            onChange={setTab}
            options={[
              { value: "all", label: "All" },
              { value: "pending", label: "Pending" },
              { value: "approved", label: "Approved" },
              { value: "rejected", label: "Rejected" },
            ]}
          />

          <Glass label="Applications" padded={false} style={s.listPanel}>
            {filtered.length === 0 ? (
              <Text style={[s.muted, s.rowPad]}>No leave applications</Text>
            ) : (
              filtered.map((app, i) => (
                <AppRow
                  key={app._id || app.id}
                  app={app}
                  first={i === 0}
                  onPress={setSelectedApp}
                />
              ))
            )}
          </Glass>

          {/* ── APPROVED HISTORY ── */}
          {approvedHistory.length > 0 && (
            <Glass
              label="Approved history"
              padded={false}
              style={s.listPanel}
              right={
                <Ionicons
                  name="checkmark-circle"
                  size={18}
                  color={colors.success}
                />
              }
            >
              {approvedHistory.map((app, i) => (
                <AppRow
                  key={app._id}
                  app={app}
                  first={i === 0}
                  showClassifier
                  onPress={setHistoryApp}
                />
              ))}
            </Glass>
          )}
        </>
      )}

      {/* ══ TEAM ══ */}
      {mainSection === "team" &&
        isManager &&
        (pendingApprovals.length === 0 ? (
          <Glass>
            <View style={st.emptyBox}>
              <Ionicons
                name="checkmark-circle"
                size={40}
                color={colors.success}
              />
              <Text style={s.emptyTitle}>All caught up!</Text>
            </View>
          </Glass>
        ) : (
          <Screen.Section title="Pending approvals">
            {pendingApprovals.map((app) => (
              <ApprovalCard
                key={app._id}
                app={app}
                busy={busyId === app._id}
                onApprove={handleApprove}
                onReject={(a) => {
                  setRejectTarget(a);
                  setRejectReason("");
                }}
                onEdit={(a) => {
                  setEditTarget(a);
                  setEditForm({
                    fromDate: a.fromDate,
                    toDate: a.toDate,
                    reason: a.reason,
                  });
                }}
                onClassify={(a) => {
                  setClassifyTarget(a);
                  setClassifyForceReason("");
                  setClassifyForceFor(null);
                }}
              />
            ))}
          </Screen.Section>
        ))}

      {/* ── WITHDRAWAL REQUESTS — manager must approve/reject ── */}
      {mainSection === "team" && isManager && withdrawRequests.length > 0 && (
        <Screen.Section
          title={`Withdrawal requests · ${withdrawRequests.length}`}
        >
          {withdrawRequests.map((app) => {
            const tone = leaveTone(colors, app.leaveType);
            const empName = app.employeeName || "—";
            return (
              <Glass
                key={app._id}
                style={[s.teamCard, { borderLeftColor: colors.warning }]}
              >
                <View style={s.personRow}>
                  <Avatar name={empName} size={42} />
                  <View style={st.flex}>
                    <Text style={s.personName} numberOfLines={1}>
                      {empName}
                    </Text>
                    <Text style={s.personMeta} numberOfLines={1}>
                      {app.department || ""}
                    </Text>
                  </View>
                  <StatusTag label="Withdraw Request" tone="warning" />
                </View>
                <View style={st.pillRow}>
                  <StatusTag
                    label={`${LEAVE_LABELS[app.leaveType] || app.leaveType} · ${app.paidDays ?? app.totalDays} days`}
                    tone={tone}
                  />
                </View>
                <Well style={s.datesRow}>
                  <View>
                    <Text style={s.dateLbl}>From</Text>
                    <Text style={s.dateVal}>{fmtDate(app.fromDate)}</Text>
                  </View>
                  <Ionicons
                    name="arrow-forward"
                    size={14}
                    color={colors.textFaint}
                  />
                  <View style={st.alignEnd}>
                    <Text style={s.dateLbl}>To</Text>
                    <Text style={s.dateVal}>{fmtDate(app.toDate)}</Text>
                  </View>
                </Well>
                {app.cancelReason ? (
                  <Text style={s.quote}>"{app.cancelReason}"</Text>
                ) : null}
                <View style={st.actionRow}>
                  <ToneButton
                    label="Reject"
                    tone={colors.danger}
                    icon={
                      <Ionicons
                        name="close-circle-outline"
                        size={14}
                        color={colors.danger}
                      />
                    }
                    style={st.flex}
                    onPress={() =>
                      Alert.alert(
                        "Reject Withdrawal",
                        `Reject ${empName}'s withdrawal request? The leave will remain active.`,
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Reject",
                            style: "destructive",
                            onPress: async () => {
                              try {
                                await apiFetch(
                                  getApiUrl(
                                    `/leave-applications/manager/${app._id}/reject-withdraw`,
                                  ),
                                  {
                                    method: "PATCH",
                                    body: JSON.stringify({
                                      remarks: "Manager rejected withdrawal",
                                    }),
                                  },
                                );
                                showToast("Withdrawal rejected");
                                await Promise.all([
                                  fetchAll(),
                                  fetchWithdrawRequests(),
                                  fetchTeamHistory(),
                                ]);
                              } catch (e) {
                                Alert.alert("Error", e.message);
                              }
                            },
                          },
                        ],
                      )
                    }
                  />
                  <PrimaryAction
                    label="Approve"
                    icon={
                      <Ionicons
                        name="checkmark-circle-outline"
                        size={14}
                        color={colors.onHero}
                      />
                    }
                    style={st.flex}
                    onPress={() =>
                      Alert.alert(
                        "Approve Withdrawal",
                        `Approve ${empName}'s withdrawal? Their leave will be cancelled and balance restored.`,
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Approve",
                            onPress: async () => {
                              try {
                                await apiFetch(
                                  getApiUrl(
                                    `/leave-applications/manager/${app._id}/approve-withdraw`,
                                  ),
                                  { method: "PATCH" },
                                );
                                showToast(
                                  "Withdrawal approved — balance restored",
                                );
                                await Promise.all([
                                  fetchAll(),
                                  fetchWithdrawRequests(),
                                  fetchTeamHistory(),
                                ]);
                              } catch (e) {
                                Alert.alert("Error", e.message);
                              }
                            },
                          },
                        ],
                      )
                    }
                  />
                </View>
              </Glass>
            );
          })}
        </Screen.Section>
      )}

      {/* ── TEAM APPROVED HISTORY ── */}
      {mainSection === "team" && isManager && teamHistory.length > 0 && (
        <Screen.Section
          title="Team approved history"
          right={
            <InlineAction
              label={showTeamHistory ? "Hide" : `Show (${teamHistory.length})`}
              onPress={() => setShowTeamHistory(!showTeamHistory)}
            />
          }
        >
          {showTeamHistory &&
            teamHistory.slice(0, 20).map((app) => {
              const tone = leaveTone(colors, app.leaveType);
              const empName = app.employeeName || "—";
              return (
                <Glass
                  key={app._id}
                  style={[s.teamCard, { borderLeftColor: tone }]}
                >
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      tap();
                      setTeamHistoryApp(app);
                    }}
                    style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                  >
                    <View style={s.personRow}>
                      <Avatar name={empName} size={42} />
                      <View style={st.flex}>
                        <Text style={s.personName} numberOfLines={1}>
                          {empName}
                        </Text>
                        <Text style={s.personMeta} numberOfLines={1}>
                          {app.department || ""}
                        </Text>
                      </View>
                      <Well style={s.daysBadge}>
                        <Text style={s.daysBadgeN}>
                          {app.paidDays ?? app.totalDays}
                        </Text>
                        <Text style={s.daysBadgeL}>days</Text>
                        {app.lwpDays > 0 && (
                          <Text style={s.daysBadgeLop}>
                            +{app.lwpDays} LOP
                          </Text>
                        )}
                      </Well>
                    </View>
                    <View style={st.pillRow}>
                      <StatusTag
                        label={LEAVE_LABELS[app.leaveType] || app.leaveType}
                        tone={tone}
                      />
                      <StatusTag label="Approved" tone="success" />
                    </View>
                    <Well style={s.datesRow}>
                      <View>
                        <Text style={s.dateLbl}>From</Text>
                        <Text style={s.dateVal}>{fmtDate(app.fromDate)}</Text>
                      </View>
                      <Ionicons
                        name="arrow-forward"
                        size={14}
                        color={colors.textFaint}
                      />
                      <View style={st.alignEnd}>
                        <Text style={s.dateLbl}>To</Text>
                        <Text style={s.dateVal}>{fmtDate(app.toDate)}</Text>
                      </View>
                    </Well>
                  </Pressable>
                </Glass>
              );
            })}
        </Screen.Section>
      )}

      {/* ══ APPLY SHEET ══ */}
      <Sheet
        visible={showApply}
        onClose={() => setShowApply(false)}
        title="Apply Leave"
        subtitle="Select leave type and dates"
        icon={<Ionicons name="create" size={18} color={colors.text} />}
      >
        <View style={st.sheetStack}>
          <LeaveTypeSelector
            value={form.leaveType}
            onChange={(t) => setForm((f) => ({ ...f, leaveType: t }))}
            /* Every "you have N left" figure in this sheet is the effective
               one. If the picker offers a number the +/- stepper below then
               refuses to reach, the form looks broken. */
            availCL={effAvail.CL || 0}
            availSL={effAvail.SL || 0}
            availPL={effAvail.PL || 0}
            eligPL={elig.plComplete}
          />

          {form.leaveType === "SL" && (
            <Well>
              <Text style={[s.noticeTitle, { color: colors.warning }]}>
                Max {slThreshold} days without medical certificate. Balance:{" "}
                {num(effAvail.SL || 0)} days.
              </Text>
            </Well>
          )}
          {form.leaveType === "LOP" && (
            <Well>
              <Text style={[s.noticeTitle, { color: colors.danger }]}>
                All selected days will be unpaid and deducted from your salary.
              </Text>
            </Well>
          )}

          <View style={st.formRow}>
            <DateField
              label="From Date"
              value={form.fromDate}
              placeholder="Start"
              onChange={(d) =>
                setForm((f) => ({
                  ...f,
                  fromDate: d,
                  toDate: !f.toDate || d > f.toDate ? d : f.toDate,
                }))
              }
            />
            {!form.isHalfDay && (
              <DateField
                label="To Date"
                value={form.toDate}
                placeholder="End"
                minimumDate={
                  form.fromDate ? parseYMD(form.fromDate) : undefined
                }
                onChange={(d) => setForm((f) => ({ ...f, toDate: d }))}
              />
            )}
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: form.isHalfDay }}
            style={({ pressed }) => [st.halfDayRow, pressed && { opacity: 0.6 }]}
            onPress={() => {
              tap();
              setForm((f) => ({ ...f, isHalfDay: !f.isHalfDay }));
            }}
          >
            <Ionicons
              name={form.isHalfDay ? "checkbox" : "square-outline"}
              size={22}
              color={form.isHalfDay ? colors.accent : colors.textFaint}
            />
            <Text style={s.halfDayText}>Half day leave</Text>
          </Pressable>

          {applyDays > 0 && (
            <Frame style={s.totalRow}>
              <Text style={s.totalLbl}>Total Days</Text>
              <Text style={s.totalVal}>{num(applyDays)}</Text>
            </Frame>
          )}

          {/* CL/PL Split */}
          {applyDays > 0 && !isDirectLeave && (
            <View>
              <Text style={s.formLabel}>LEAVE SPLIT</Text>
              <Frame>
                {form.leaveType === "CL" && (
                  <SplitRow
                    first
                    label="CL — Casual Leave"
                    sublabel={`${num(effAvail.CL || 0)} avail · ${num(clMonthlyRemaining)}/${maxCLPerMonth} mo`}
                    value={split.CL}
                    canAdd={split.CL < maxCL && usedPaid < applyDays}
                    onMinus={() => adjustSplit("CL", -1)}
                    onPlus={() => adjustSplit("CL", 1)}
                  />
                )}
                {form.leaveType === "PL" && elig.plComplete && (
                  <SplitRow
                    first
                    label="PL — Privilege Leave"
                    sublabel={`${num(effAvail.PL || 0)} available`}
                    value={split.PL}
                    canAdd={split.PL < maxPL && usedPaid < applyDays}
                    onMinus={() => adjustSplit("PL", -1)}
                    onPlus={() => adjustSplit("PL", 1)}
                  />
                )}
                <LopRow
                  label="LOP — Loss of Pay"
                  note="Auto-calculated"
                  value={num(lop)}
                />
              </Frame>
            </View>
          )}

          <View>
            <Text style={s.formLabel}>Reason</Text>
            <TextInput
              style={[s.formInput, st.tallInput]}
              value={form.reason}
              onChangeText={(v) => setForm((f) => ({ ...f, reason: v }))}
              placeholder={
                form.leaveType === "SL"
                  ? "Describe your illness..."
                  : form.leaveType === "LOP"
                    ? "Reason for unpaid leave..."
                    : "Why are you taking leave?"
              }
              placeholderTextColor={colors.textFaint}
              multiline
            />
          </View>

          <PrimaryAction
            label="Submit Application"
            onPress={handleApply}
            loading={!!applyLoading}
            disabled={!!applyLoading || applyDays === 0}
          />
        </View>
      </Sheet>

      {/* ══ MANAGER EDIT SHEET ══ */}
      <Sheet
        visible={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={`Edit — ${editTarget?.employeeName || ""}`}
        subtitle={isSecondaryMgr ? "Edit dates & split" : "Edit dates only"}
        icon={<Ionicons name="create" size={18} color={colors.text} />}
      >
        {editTarget && (
          <View style={st.sheetStack}>
            <View style={st.formRow}>
              <DateField
                label="From"
                value={editForm.fromDate}
                onChange={(d) => {
                  setEditForm((f) => ({ ...f, fromDate: d }));
                  if (d > editForm.toDate)
                    setEditForm((f) => ({ ...f, toDate: d }));
                }}
              />
              <DateField
                label="To"
                value={editForm.toDate}
                minimumDate={
                  editForm.fromDate ? parseYMD(editForm.fromDate) : undefined
                }
                onChange={(d) => setEditForm((f) => ({ ...f, toDate: d }))}
              />
            </View>
            {editDays > 0 && (
              <Frame style={s.totalRow}>
                <Text style={s.totalLbl}>Total Days</Text>
                <Text style={s.totalVal}>{editDays}</Text>
              </Frame>
            )}
            {editDays > 0 && isSecondaryMgr && (
              <View>
                <Text style={s.formLabel}>LEAVE SPLIT</Text>
                <Frame>
                  <SplitRow
                    first
                    label="CL — Casual Leave"
                    value={editSplit.CL}
                    canAdd={editSplit.CL < editMaxCL && editUsed < editDays}
                    onMinus={() => adjustEditSplit("CL", -1)}
                    onPlus={() => adjustEditSplit("CL", 1)}
                  />
                  {editMaxPL > 0 && (
                    <SplitRow
                      label="PL — Privilege Leave"
                      value={editSplit.PL}
                      canAdd={editSplit.PL < editMaxPL && editUsed < editDays}
                      onMinus={() => adjustEditSplit("PL", -1)}
                      onPlus={() => adjustEditSplit("PL", 1)}
                    />
                  )}
                  <LopRow label="LOP" note="Auto-calculated" value={editLop} />
                </Frame>
              </View>
            )}
            <View>
              <Text style={s.formLabel}>Reason</Text>
              <TextInput
                style={[s.formInput, st.midInput]}
                value={editForm.reason}
                onChangeText={(v) => setEditForm((f) => ({ ...f, reason: v }))}
                placeholderTextColor={colors.textFaint}
                multiline
              />
            </View>
            <PrimaryAction
              label="Save Changes"
              onPress={handleEditSave}
              loading={editLoading}
              disabled={editLoading || editDays === 0}
            />
          </View>
        )}
      </Sheet>

      {/* ══ REJECT SHEET ══ */}
      <Sheet
        visible={!!rejectTarget}
        onClose={() => {
          setRejectTarget(null);
          setRejectReason("");
        }}
        title="Reject Leave"
        subtitle={rejectTarget?.employeeName || ""}
        icon={<Ionicons name="close-circle" size={18} color={colors.text} />}
      >
        {rejectTarget && (
          <View style={st.sheetStack}>
            <Well>
              <Text style={[s.noticeTitle, { color: colors.danger }]}>
                {rejectTarget.employeeName} —{" "}
                {LEAVE_LABELS[rejectTarget.leaveType]} ({rejectTarget.totalDays}{" "}
                days)
              </Text>
              <Text style={[s.noticeBody, { color: colors.danger }]}>
                {fmtDate(rejectTarget.fromDate)} →{" "}
                {fmtDate(rejectTarget.toDate)}
              </Text>
            </Well>
            <View>
              <Text style={s.formLabel}>Rejection Reason (required)</Text>
              <TextInput
                style={[s.formInput, st.tallInput]}
                value={rejectReason}
                onChangeText={setRejectReason}
                placeholder="Why are you rejecting this leave?"
                placeholderTextColor={colors.textFaint}
                multiline
                autoFocus
              />
            </View>
            <ToneButton
              label="Confirm Rejection"
              tone={colors.danger}
              loading={rejectLoading}
              disabled={rejectLoading || !rejectReason.trim()}
              onPress={handleRejectConfirm}
              style={st.commit}
            />
          </View>
        )}
      </Sheet>

      {/* ══ CLASSIFY QUICK-APPLY (secondary manager picks CL / SL / LOP) ══ */}
      <Sheet
        visible={!!classifyTarget}
        onClose={() => {
          if (classifyLoading) return;
          setClassifyTarget(null);
          setClassifyForceReason("");
          setClassifyForceFor(null);
        }}
        title="Classify Leave"
        subtitle={
          classifyTarget
            ? `${classifyTarget.employeeName} · ${classifyTarget.isHalfDay ? "Half day" : "Full day"} on ${fmtDate(classifyTarget.fromDate)}`
            : ""
        }
      >
        {classifyTarget && (
          <View style={st.sheetStack}>
            {classifyTarget.reason ? (
              <Well>
                <Text style={s.wellLabel}>EMPLOYEE'S REASON</Text>
                <Text style={s.wellBody}>{classifyTarget.reason}</Text>
              </Well>
            ) : null}

            <Text style={s.formLabel}>Pick the leave type</Text>

            {[
              {
                key: "CL",
                icon: "sunny-outline",
                title: "Casual Leave",
                desc: "Deducts from CL balance (yearly + monthly cap apply)",
              },
              {
                key: "SL",
                icon: "medkit-outline",
                title: "Sick Leave",
                desc: "Deducts from SL balance; excess auto-splits to LWP",
              },
              {
                key: "LOP",
                icon: "close-circle-outline",
                title: "Loss of Pay (LOP)",
                desc: "Unpaid leave — no balance deducted",
              },
            ].map((opt) => {
              const tone = leaveTone(colors, opt.key);
              return (
                <Pressable
                  key={opt.key}
                  accessibilityRole="button"
                  disabled={classifyLoading}
                  onPress={() => {
                    tap();
                    handleResolveQuick(
                      opt.key,
                      opt.key === "LOP" ? classifyForceReason : null,
                    );
                  }}
                  style={({ pressed }) => [
                    s.well,
                    s.classifyOption,
                    { borderColor: tone },
                    classifyLoading && s.dim,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Ionicons name={opt.icon} size={20} color={tone} />
                  <View style={st.flex}>
                    <Text style={[s.classifyTitle, { color: tone }]}>
                      {opt.title}
                    </Text>
                    <Text style={s.classifyDesc}>{opt.desc}</Text>
                  </View>
                </Pressable>
              );
            })}

            {classifyForceFor === "LOP" ? (
              <Frame style={[s.forceBox, { borderColor: colors.warning }]}>
                <Text style={[s.wellLabel, { color: colors.warning }]}>
                  REASON FOR FORCING LOP
                </Text>
                <Text style={[s.noticeBody, { color: colors.warning }]}>
                  Employee has CL/SL balance available. Type a reason below,
                  then tap Submit.
                </Text>
                <TextInput
                  style={[s.formInput, st.midInput, st.forceInput]}
                  placeholder="e.g. disciplinary, exceeded cap, employee preference, etc."
                  placeholderTextColor={colors.textFaint}
                  value={classifyForceReason}
                  onChangeText={setClassifyForceReason}
                  editable={!classifyLoading}
                  multiline
                />
                <ToneButton
                  label="Submit LOP with Reason"
                  tone={colors.danger}
                  icon={
                    <Ionicons
                      name="close-circle"
                      size={16}
                      color={colors.danger}
                    />
                  }
                  loading={classifyLoading}
                  disabled={classifyLoading || !classifyForceReason.trim()}
                  onPress={() =>
                    handleResolveQuick("LOP", classifyForceReason)
                  }
                />
              </Frame>
            ) : null}

            {classifyLoading ? (
              <ActivityIndicator color={colors.accent} />
            ) : null}

            <Text style={s.footnote}>
              After you classify, the primary manager gives the final approval.
            </Text>
          </View>
        )}
      </Sheet>

      {/* ══ LEAVE DETAIL SHEET (with Withdraw button) ══ */}
      <Sheet
        visible={!!selectedApp}
        onClose={() => setSelectedApp(null)}
        title={
          selectedApp
            ? LEAVE_LABELS[selectedApp.leaveType] || selectedApp.leaveType
            : ""
        }
        subtitle={
          selectedApp
            ? `${fmtDate(selectedApp.fromDate)} → ${fmtDate(selectedApp.toDate || selectedApp.fromDate)}`
            : ""
        }
      >
        {selectedApp && (
          <View style={st.sheetStack}>
            <View style={st.detailRow}>
              <Text style={s.detailLbl}>Status</Text>
              {/* A sheet is a `strong` panel, so the tag mixes its tint
                  against that surface rather than the default deck. */}
              <StatusTag status={selectedApp.status} on="panelStrong" />
            </View>
            <View style={st.detailRow}>
              <Text style={s.detailLbl}>Duration</Text>
              <Text style={s.detailVal}>
                {selectedApp.totalDays} day
                {selectedApp.totalDays !== 1 ? "s" : ""}
                {selectedApp.isHalfDay ? " (Half)" : ""}
              </Text>
            </View>
            {selectedApp.paidDays != null && (
              <Well style={st.detailRow}>
                <Text style={s.breakdownPaid}>
                  {num(selectedApp.paidDays)} {selectedApp.leaveType} (Paid)
                </Text>
                <Text
                  style={[
                    s.breakdownLop,
                    {
                      color:
                        selectedApp.lwpDays > 0 ? colors.danger : colors.success,
                    },
                  ]}
                >
                  {selectedApp.lwpDays || 0} LOP
                </Text>
              </Well>
            )}
            {selectedApp.reason ? (
              <View>
                <Text style={s.detailLbl}>Reason</Text>
                <Text style={[s.detailVal, st.spaceTop]}>
                  {selectedApp.reason}
                </Text>
              </View>
            ) : null}

            {/* Withdraw — shown for pending, manager_approved and hr_approved */}
            {["pending", "manager_approved", "hr_approved"].includes(
              selectedApp.status,
            ) && (
              <ToneButton
                label="Withdraw Application"
                tone={colors.danger}
                icon={
                  <Ionicons
                    name="return-up-back-outline"
                    size={18}
                    color={colors.danger}
                  />
                }
                loading={withdrawLoading}
                disabled={withdrawLoading}
                onPress={() => handleWithdraw(selectedApp)}
                style={st.commit}
              />
            )}
          </View>
        )}
      </Sheet>

      {/* ══ HISTORY DETAIL SHEET ══ */}
      <Sheet
        visible={!!historyApp}
        onClose={() => setHistoryApp(null)}
        title={
          historyApp
            ? LEAVE_LABELS[historyApp.leaveType] || historyApp.leaveType
            : ""
        }
        subtitle={
          historyApp
            ? `${fmtDate(historyApp.fromDate)} → ${fmtDate(historyApp.toDate || historyApp.fromDate)}`
            : ""
        }
      >
        {historyApp && (
          <View style={st.sheetStack}>
            <Well style={st.detailRow}>
              <Text style={[s.noticeTitle, { color: colors.success }]}>
                Approved Leave
              </Text>
              <Text style={s.detailMeta}>
                {historyApp.hrApprovedAt
                  ? fmtDate(historyApp.hrApprovedAt.split("T")[0])
                  : "—"}
              </Text>
            </Well>

            <Frame>
              <View style={s.frameBlock}>
                <View style={st.detailRowTight}>
                  <Text style={s.detailLbl}>Leave Type</Text>
                  <StatusTag
                    label={
                      LEAVE_LABELS[historyApp.leaveType] || historyApp.leaveType
                    }
                    tone={leaveTone(colors, historyApp.leaveType)}
                    on="panelStrong"
                  />
                </View>
                <View style={st.detailRowTight}>
                  <Text style={s.detailLbl}>Total Days</Text>
                  <Text style={s.detailVal}>
                    {historyApp.totalDays} day
                    {historyApp.totalDays !== 1 ? "s" : ""}
                  </Text>
                </View>
                {historyApp.paidDays != null && (
                  <>
                    <View style={st.detailRowTight}>
                      <Text style={s.detailLbl}>
                        Paid Days ({historyApp.leaveType})
                      </Text>
                      <Text style={[s.detailVal, { color: colors.success }]}>
                        {num(historyApp.paidDays)}
                      </Text>
                    </View>
                    <View style={st.detailRow}>
                      <Text style={s.detailLbl}>LOP Days</Text>
                      <Text
                        style={[
                          s.detailVal,
                          {
                            color:
                              historyApp.lwpDays > 0
                                ? colors.danger
                                : colors.textFaint,
                          },
                        ]}
                      >
                        {historyApp.lwpDays || 0}
                      </Text>
                    </View>
                  </>
                )}
              </View>

              <View style={[s.frameBlock, s.frameDivider]}>
                <View style={st.detailRowTight}>
                  <Text style={s.detailLbl}>From</Text>
                  <Text style={s.detailVal}>{fmtDate(historyApp.fromDate)}</Text>
                </View>
                <View style={st.detailRow}>
                  <Text style={s.detailLbl}>To</Text>
                  <Text style={s.detailVal}>
                    {fmtDate(historyApp.toDate || historyApp.fromDate)}
                  </Text>
                </View>
              </View>

              {historyApp.managerDecisions &&
                historyApp.managerDecisions.length > 0 && (
                  <View style={[s.frameBlock, s.frameDivider]}>
                    <Text style={[s.detailLbl, st.spaceBottom]}>
                      Approved By
                    </Text>
                    {historyApp.managerDecisions
                      .filter((d) => d.decision === "approved")
                      .map((d, i) => (
                        <View key={i} style={st.approverRow}>
                          <Avatar name={d.managerName || ""} size={28} />
                          <View style={st.flex}>
                            <Text style={s.approverName}>
                              {d.managerName || "Manager"}
                            </Text>
                            <Text style={s.approverRole}>
                              {d.type === "primary"
                                ? "Primary Manager"
                                : "Secondary Manager"}
                            </Text>
                          </View>
                          <Ionicons
                            name="checkmark-circle"
                            size={18}
                            color={colors.success}
                          />
                        </View>
                      ))}
                  </View>
                )}
            </Frame>

            {historyApp.reason ? (
              <View>
                <Text style={s.detailLbl}>Reason</Text>
                <Well
                  style={[
                    s.reasonBox,
                    st.spaceTop,
                    { borderLeftColor: colors.accent },
                  ]}
                >
                  <Text style={s.reasonText}>{historyApp.reason}</Text>
                </Well>
              </View>
            ) : null}

            {historyApp.hrRemarks ? (
              <View>
                <Text style={s.detailLbl}>Remarks</Text>
                <Text style={[s.detailVal, st.spaceTop, { color: colors.textMuted }]}>
                  {historyApp.hrRemarks}
                </Text>
              </View>
            ) : null}

            {/* Withdraw from history too */}
            <ToneButton
              label="Withdraw Application"
              tone={colors.danger}
              icon={
                <Ionicons
                  name="return-up-back-outline"
                  size={18}
                  color={colors.danger}
                />
              }
              disabled={withdrawLoading}
              onPress={() => {
                setHistoryApp(null);
                setTimeout(() => handleWithdraw(historyApp), 300);
              }}
              style={st.commit}
            />
          </View>
        )}
      </Sheet>

      {/* ══ TEAM HISTORY DETAIL SHEET ══ */}
      <Sheet
        visible={!!teamHistoryApp}
        onClose={() => setTeamHistoryApp(null)}
        title={
          teamHistoryApp
            ? LEAVE_LABELS[teamHistoryApp.leaveType] || teamHistoryApp.leaveType
            : ""
        }
        subtitle={
          teamHistoryApp
            ? `${teamHistoryApp.employeeName || ""} · ${fmtDate(teamHistoryApp.fromDate)} → ${fmtDate(teamHistoryApp.toDate || teamHistoryApp.fromDate)}`
            : ""
        }
      >
        {teamHistoryApp && (
          <View style={st.sheetStack}>
            <Well style={st.detailRow}>
              <Text style={[s.noticeTitle, { color: colors.success }]}>
                Approved Leave
              </Text>
              <Text style={s.detailMeta}>
                {teamHistoryApp.hrApprovedAt
                  ? fmtDate(teamHistoryApp.hrApprovedAt.split?.("T")?.[0] || "")
                  : "—"}
              </Text>
            </Well>
            <Frame>
              <View style={s.frameBlock}>
                <View style={st.detailRowTight}>
                  <Text style={s.detailLbl}>Employee</Text>
                  <Text style={s.detailVal}>{teamHistoryApp.employeeName}</Text>
                </View>
                <View style={st.detailRowTight}>
                  <Text style={s.detailLbl}>Department</Text>
                  <Text style={s.detailVal}>
                    {teamHistoryApp.department || "—"}
                  </Text>
                </View>
                <View style={st.detailRowTight}>
                  <Text style={s.detailLbl}>Leave Type</Text>
                  <StatusTag
                    label={
                      LEAVE_LABELS[teamHistoryApp.leaveType] ||
                      teamHistoryApp.leaveType
                    }
                    tone={leaveTone(colors, teamHistoryApp.leaveType)}
                    on="panelStrong"
                  />
                </View>
                <View style={st.detailRowTight}>
                  <Text style={s.detailLbl}>Total Days</Text>
                  <Text style={s.detailVal}>{teamHistoryApp.totalDays}</Text>
                </View>
                {teamHistoryApp.paidDays != null && (
                  <>
                    <View style={st.detailRowTight}>
                      <Text style={s.detailLbl}>Paid Days</Text>
                      <Text style={[s.detailVal, { color: colors.success }]}>
                        {teamHistoryApp.paidDays}
                      </Text>
                    </View>
                    <View style={st.detailRow}>
                      <Text style={s.detailLbl}>LOP Days</Text>
                      <Text
                        style={[
                          s.detailVal,
                          {
                            color:
                              teamHistoryApp.lwpDays > 0
                                ? colors.danger
                                : colors.textFaint,
                          },
                        ]}
                      >
                        {teamHistoryApp.lwpDays || 0}
                      </Text>
                    </View>
                  </>
                )}
              </View>
              <View style={[s.frameBlock, s.frameDivider]}>
                <View style={st.detailRowTight}>
                  <Text style={s.detailLbl}>From</Text>
                  <Text style={s.detailVal}>
                    {fmtDate(teamHistoryApp.fromDate)}
                  </Text>
                </View>
                <View style={st.detailRow}>
                  <Text style={s.detailLbl}>To</Text>
                  <Text style={s.detailVal}>
                    {fmtDate(teamHistoryApp.toDate || teamHistoryApp.fromDate)}
                  </Text>
                </View>
              </View>
            </Frame>
            {teamHistoryApp.reason ? (
              <View>
                <Text style={s.detailLbl}>Reason</Text>
                <Well
                  style={[
                    s.reasonBox,
                    st.spaceTop,
                    { borderLeftColor: colors.accent },
                  ]}
                >
                  <Text style={s.reasonText}>{teamHistoryApp.reason}</Text>
                </Well>
              </View>
            ) : null}
          </View>
        )}
      </Sheet>
    </Screen>
  );
}

// ── Colour-free geometry ────────────────────────────────────────────────────
// Anything that varies by scheme lives in makeStyles, so a stale StyleSheet
// can never pin a light-mode colour into dark mode.
const st = StyleSheet.create({
  flex: { flex: 1 },

  // Leave-type options stack in a COLUMN, one full-width row each.
  //
  // Two reasons. First, this key did not exist at all — `st.typeWrap` resolved
  // to undefined, so the container had no style and the chips fell back to
  // whatever the default gave them. Second, a row of four chips forces each to
  // ~72px, which truncates "Privilege" and leaves no room for the balance
  // beneath the name. A column gives every option its full label, its
  // remaining days, and a 44pt touch target.
  typeWrap: { gap: spacing.tight },
  alignEnd: { alignItems: "flex-end" },
  spaceTop: { marginTop: spacing.hair },
  spaceBottom: { marginBottom: spacing.tight },

  // Sheet
  sheetOverlay: { flex: 1, justifyContent: "flex-end" },
  sheetBody: { flexShrink: 1, maxHeight: SH * 0.62 },
  sheetBodyContent: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.section,
  },
  sheetStack: { gap: spacing.snug },

  // Quick apply
  quickWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.tight,
    marginTop: spacing.snug,
  },

  // Balance
  balRow: { flexDirection: "row", gap: spacing.snug },
  balCell: { flex: 1, alignItems: "center" },
  balBarFill: { height: 4, borderRadius: 2 },

  // Cards
  pillRow: {
    flexDirection: "row",
    gap: spacing.hair + 2,
    flexWrap: "wrap",
    marginBottom: spacing.tight,
  },
  actionRow: { flexDirection: "row", gap: spacing.tight, marginTop: spacing.tight },
  emptyBox: { alignItems: "center", gap: spacing.tight, paddingVertical: spacing.loose },
  rowMetaLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.hair + 2,
    marginTop: 2,
  },

  // Split box
  splitControls: { flexDirection: "row", alignItems: "center", gap: spacing.hair + 2 },
  splitValue: { width: 44, alignItems: "center" },

  // Forms
  formRow: { flexDirection: "row", gap: spacing.tight },
  halfDayRow: { flexDirection: "row", alignItems: "center", gap: spacing.tight },
  tallInput: { minHeight: 80, textAlignVertical: "top" },
  midInput: { minHeight: 60, textAlignVertical: "top" },
  forceInput: { marginTop: spacing.tight, marginBottom: spacing.tight },
  commit: { marginTop: spacing.hair },

  // Detail rows
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  detailRowTight: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.hair + 2,
  },
  approverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.tight,
    marginBottom: spacing.hair + 2,
  },

  // Toast
  toast: { paddingVertical: spacing.snug, paddingHorizontal: spacing.base },
  toastRow: { flexDirection: "row", alignItems: "center", gap: spacing.tight },
});

const makeStyles = (colors) =>
  StyleSheet.create({
    muted: { ...type.body, color: colors.textMuted, paddingVertical: spacing.snug },
    dim: { opacity: 0.4 },
    hint: {
      ...type.caption,
      color: colors.textFaint,
      marginTop: spacing.snug,
    },

    // ── The two child-of-a-panel surfaces ───────────────────────────────────
    well: {
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
      padding: spacing.snug,
    },
    frame: {
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.hairline,
      overflow: "hidden",
    },
    frameBlock: { padding: spacing.snug },
    frameDivider: {
      borderTopWidth: layout.hairlineWidth,
      borderTopColor: colors.hairline,
    },

    // ── Controls ────────────────────────────────────────────────────────────
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.tight,
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
      paddingVertical: spacing.snug,
      paddingHorizontal: spacing.snug,
    },
    chipText: { ...type.caption, color: colors.text },
    toneBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.tight,
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: 1,
      paddingVertical: 13,
      paddingHorizontal: spacing.base,
    },

    // ── Sheet ───────────────────────────────────────────────────────────────
    sheet: {
      borderRadius: 0,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      borderBottomWidth: 0,
    },
    sheetHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.hairline,
      alignSelf: "center",
      marginTop: spacing.snug,
      marginBottom: spacing.tight,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.snug,
      paddingHorizontal: spacing.base,
      paddingBottom: spacing.snug,
      borderBottomWidth: layout.hairlineWidth,
      borderBottomColor: colors.hairline,
    },
    sheetIcon: {
      width: 36,
      height: 36,
      padding: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    sheetTitle: { ...type.title, color: colors.text },
    sheetSubtitle: { ...type.caption, color: colors.textMuted, marginTop: 2 },
    sheetClose: {
      width: 30,
      height: 30,
      borderRadius: radius.tag,
      backgroundColor: colors.inset,
      alignItems: "center",
      justifyContent: "center",
    },
    iosHead: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.snug,
      borderBottomWidth: layout.hairlineWidth,
      borderBottomColor: colors.hairline,
    },

    // ── Balance ─────────────────────────────────────────────────────────────
    balType: { ...type.label, color: colors.text },
    balAvail: { ...type.figure, color: colors.text, marginTop: spacing.hair },
    balOfTotal: { ...type.caption, color: colors.textFaint },
    balBar: {
      width: "100%",
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.inset,
      marginTop: spacing.tight,
      overflow: "hidden",
    },
    balUsed: { ...type.caption, marginTop: spacing.hair + 2 },
    monthLabel: {
      ...type.caption,
      color: colors.textMuted,
      textAlign: "center",
      marginBottom: spacing.tight,
    },

    // ── Application rows ────────────────────────────────────────────────────
    listPanel: { paddingVertical: spacing.hair },
    rowPad: { paddingHorizontal: spacing.base },
    typeDot: { width: 8, height: 8, borderRadius: 4 },
    rowTitle: { ...type.title, color: colors.text },
    rowClassifier: { ...type.caption, color: colors.textFaint, marginTop: 1 },
    rowDates: { ...type.caption, color: colors.textMuted, marginTop: 2 },
    rowDays: { ...type.caption, color: colors.textFaint },
    emptyTitle: { ...type.title, color: colors.text },

    // ── Team cards ──────────────────────────────────────────────────────────
    teamCard: { borderLeftWidth: 3 },
    personRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.snug,
      marginBottom: spacing.tight,
    },
    personName: { ...type.title, color: colors.text },
    personMeta: { ...type.caption, color: colors.textFaint, marginTop: 1 },
    daysBadge: { alignItems: "center", paddingVertical: spacing.hair + 2, paddingHorizontal: spacing.tight },
    daysBadgeN: { ...type.figure, fontSize: 18, lineHeight: 20, color: colors.text },
    daysBadgeL: { ...type.caption, fontSize: 10, color: colors.textFaint },
    daysBadgeLop: { ...type.caption, fontSize: 10, color: colors.danger, marginTop: 2 },

    breakdownRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.tight,
      marginBottom: spacing.tight,
    },
    breakdownPaid: { ...type.caption, color: colors.text },
    breakdownSep: { ...type.caption, color: colors.textFaint },
    breakdownLop: { ...type.caption, color: colors.success },

    datesRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    dateLbl: { ...type.label, fontSize: 9, letterSpacing: 0.8, color: colors.textFaint },
    dateVal: { ...type.caption, color: colors.text, marginTop: 1 },

    reasonToggle: { alignSelf: "flex-start", marginTop: spacing.hair },
    reasonBox: { borderLeftWidth: 2 },
    reasonText: { ...type.caption, color: colors.text, lineHeight: 18 },

    noticeBox: { marginTop: spacing.tight },
    noticeTitle: { ...type.caption, color: colors.text },
    noticeBody: { ...type.caption, color: colors.textMuted, marginTop: 2 },
    quote: {
      ...type.caption,
      color: colors.textMuted,
      fontStyle: "italic",
      marginTop: spacing.tight,
    },
    editBtn: { marginTop: spacing.tight },

    // ── Split box ───────────────────────────────────────────────────────────
    splitRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.snug,
      paddingVertical: spacing.snug,
    },
    splitDivider: {
      borderTopWidth: layout.hairlineWidth,
      borderTopColor: colors.hairline,
    },
    splitLabelWrap: { flex: 1, marginRight: spacing.tight },
    splitLabel: { ...type.title, color: colors.text },
    splitSub: { ...type.caption, fontSize: 10, color: colors.textFaint, marginTop: 2 },
    splitBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.tag,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
      backgroundColor: colors.inset,
      alignItems: "center",
      justifyContent: "center",
    },
    splitBtnGlyph: { ...type.title, fontSize: 18, lineHeight: 22 },
    splitNum: { ...type.figure, fontSize: 18, lineHeight: 20 },

    // ── Forms ───────────────────────────────────────────────────────────────
    formLabel: { ...type.label, color: colors.textMuted, marginBottom: spacing.tight },
    formInput: {
      ...type.body,
      color: colors.text,
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
      paddingHorizontal: spacing.snug,
      paddingVertical: spacing.snug,
    },
    dateBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.tight,
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
      paddingHorizontal: spacing.snug,
      paddingVertical: 13,
    },
    dateBtnText: { ...type.caption, color: colors.text },
    halfDayText: { ...type.body, color: colors.text },

    totalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.snug,
    },
    totalLbl: { ...type.body, color: colors.textMuted },
    totalVal: { ...type.figure, color: colors.text },

    // ── Type selector ───────────────────────────────────────────────────────
    typeChip: {
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.base,
      // 44pt minimum: this is a radio group people tap every time they apply.
      minHeight: 46,
    },
    typeChipKey: { ...type.title },
    typeChipMeta: { ...type.caption, color: colors.textMuted },

    // ── Classify ────────────────────────────────────────────────────────────
    classifyOption: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.tight,
      paddingVertical: spacing.base,
    },
    classifyTitle: { ...type.title },
    classifyDesc: { ...type.caption, color: colors.textMuted, marginTop: 2 },
    forceBox: { padding: spacing.snug },
    footnote: {
      ...type.caption,
      color: colors.textFaint,
      fontStyle: "italic",
      textAlign: "center",
      marginTop: spacing.tight,
    },
    wellLabel: { ...type.label, color: colors.textMuted, marginBottom: spacing.hair },
    wellBody: { ...type.body, color: colors.text },

    // ── Detail sheets ───────────────────────────────────────────────────────
    detailLbl: { ...type.caption, color: colors.textMuted },
    detailVal: { ...type.title, color: colors.text },
    detailMeta: { ...type.caption, color: colors.textMuted },
    approverName: { ...type.caption, color: colors.text },
    approverRole: { ...type.caption, fontSize: 10, color: colors.textFaint },

    toastText: { ...type.body, color: colors.text, flex: 1 },
  });
