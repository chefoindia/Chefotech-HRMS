// src/screens/RegularizeScreen.js
//
// Raise a correction for a day the biometric device got wrong, and see the
// ones already raised.
//
// This replaces the Tasks screen, which showed interview tasks that don't
// apply to most staff and was empty for everyone else. Regularization is the
// thing employees actually need from an attendance app: the device misses a
// punch, and without this the only recourse is finding someone in HR.
//
// The day picker is seeded from real attendance rather than a blank date
// field. An employee knows "Tuesday was wrong", not the ISO date, and a day
// already marked Present rarely needs correcting — so the days that plausibly
// need attention are offered first.
//
// LAYOUT: this page is a <Screen> — see the HOW TO BUILD A SCREEN block at the
// top of components/ui/Screen.js. It owns the ground, the safe area, the
// scroller, the gutter, the page head, pull-to-refresh and the nav-pill
// clearance. Nothing below sets a backgroundColor except through `colors.inset`,
// which is the one token a child of a panel is allowed to paint.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAuth } from "../context/AuthContext";
import { getApiUrl, API_CONFIG } from "../lib/api";
import { useResource, clearCache } from "../lib/resource";
import {
  Screen,
  Glass,
  StatusTag,
  PrimaryAction,
  InlineAction,
  SegmentedToggle,
  Calendar,
  TimePickerSheet,
  formatHHMM,
} from "../components/ui";
import { tap, notify } from "../lib/feedback";
import { useTheme, radius, spacing, layout, type } from "../theme";

const REG = API_CONFIG.endpoints.regularization;

const REASONS = [
  { value: "miss_punch", label: "Missed punch" },
  { value: "forgot_punch", label: "Forgot" },
  { value: "wrong_status", label: "Wrong status" },
  { value: "client_visit", label: "Client visit" },
];

// Includes `other`, which the submit form does not offer but HR can file — a
// manager still has to be told what kind of request they are looking at.
const TYPE_LABEL = {
  ...Object.fromEntries(REASONS.map((r) => [r.value, r.label])),
  other: "Other",
};

// Two rows of two rather than one row of four: at caption size, four segments
// across a phone truncates "Wrong status" and "Missed punch" to nothing
// readable. Split here so the component stays a plain radiogroup.
const REASONS_TOP = REASONS.slice(0, 2);
const REASONS_BOTTOM = REASONS.slice(2);

// A missed or forgotten punch is a question about CLOCK TIMES; a wrong status
// is a question about what the day should have been called. They are different
// requests wearing one form, and asking for both every time is how a form
// becomes something people give up on.
const NEEDS_TIMES = ["miss_punch", "forgot_punch"];

// What an employee is allowed to ask a day to become. Deliberately narrower
// than the attendance system's full status vocabulary: leave codes (L-CL,
// L-SL, L-EL) go through the leave module so the balance is actually
// deducted, and absence and holiday codes are not an employee's to request.
// Asking for them here would create a day nobody's balance paid for.
//
// Values are the stored codes and must stay byte-identical to the backend's
// enum; only the labels are ours. Three rows of two, for the same truncation
// reason as the type toggle above.
const STATUS_ROWS = [
  [
    { value: "P", label: "Present" },
    { value: "HD", label: "Half day" },
  ],
  [
    { value: "WFH", label: "Work from home" },
    { value: "CO", label: "Comp. off" },
  ],
  [
    { value: "P*", label: "Present (late)" },
    { value: "P~", label: "Present (early)" },
  ],
];
const STATUS_LABEL = Object.fromEntries(
  STATUS_ROWS.flat().map((o) => [o.value, o.label]),
);

function resolveStatus(day) {
  return (
    [day.effectiveStatus, day.hrFinalStatus, day.systemPrediction, day.status].find(
      Boolean,
    ) || null
  );
}

/**
 * `dateStr` is an ISO day with no zone. Parsing it bare makes JS read it as
 * UTC and shift a day backwards west of the meridian, so the midnight suffix
 * stays. A missing or unparseable value renders as an em dash rather than the
 * string "Invalid Date".
 */
function formatDay(dateStr, opts) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", opts);
}

/**
 * A stored proposed punch comes back as a full instant. Read it in IST — shift
 * the epoch and use getUTC*, never getHours(), which would render the phone's
 * timezone and quietly show a different hour to anyone travelling.
 */
function istClock(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return formatHHMM(
    `${String(ist.getUTCHours()).padStart(2, "0")}:${String(
      ist.getUTCMinutes(),
    ).padStart(2, "0")}`,
  );
}

/** One line saying what a submitted request actually asked for. */
function askedFor(r) {
  const bits = [];
  const i = istClock(r.proposedInTime);
  const o = istClock(r.proposedOutTime);
  if (i) bits.push(`In ${i}`);
  if (o) bits.push(`Out ${o}`);
  if (r.requestedStatus)
    bits.push(STATUS_LABEL[r.requestedStatus] || r.requestedStatus);
  return bits.join(" · ");
}

/**
 * A clock-time slot in the form. Optional by design — a missed morning punch
 * has an IN time and no OUT time, and forcing both would make the employee
 * invent one.
 *
 * The sheet is this app's own, not the platform's, so Android and iOS show the
 * identical control. See the note at the top of TimePickerSheet.js.
 */
function TimeField({ label, value, onChange, s, colors }) {
  const [show, setShow] = useState(false);
  return (
    <View style={s.timeField}>
      <View style={s.timeHead}>
        <Text style={s.fieldLabel}>{label}</Text>
        {value ? (
          <InlineAction label="Clear" tone="textMuted" onPress={() => onChange(null)} />
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}, ${formatHHMM(value)}` : `Set ${label}`}
        style={({ pressed }) => [s.timeBtn, pressed && { opacity: 0.7 }]}
        onPress={() => {
          tap();
          setShow(true);
        }}
      >
        <Ionicons
          name="time-outline"
          size={16}
          color={value ? colors.accent : colors.textFaint}
        />
        <Text
          style={[s.timeBtnText, !value && { color: colors.textFaint }]}
          numberOfLines={1}
        >
          {value ? formatHHMM(value) : "Not set"}
        </Text>
      </Pressable>
      <TimePickerSheet
        visible={show}
        value={value}
        onChange={onChange}
        onClose={() => setShow(false)}
        title={label}
      />
    </View>
  );
}

/**
 * One request awaiting this manager's decision.
 *
 * The approval chain is primary → secondary, and whoever is LAST says yes
 * writes the attendance row — there is no HR step afterwards for a request
 * filed in the app. So the card has to show what will actually be written, not
 * just who asked for what: approving blind is how a day gets a punch nobody
 * checked. `askedFor` is the same summary the employee saw when they submitted.
 *
 * Reject asks for a reason inline rather than through Alert.prompt, which
 * exists only on iOS — on Android it is silently undefined and the rejection
 * would ship with no explanation at all.
 */
function TeamRequestCard({ req, busy, onApprove, onReject, s, colors }) {
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState("");
  const asked = askedFor(req);

  return (
    <Glass>
      <View style={s.teamHead}>
        <View style={s.teamWho}>
          <Text style={s.teamName} numberOfLines={1}>
            {req.employeeName || "Employee"}
          </Text>
          <Text style={s.teamMeta} numberOfLines={1}>
            {formatDay(req.dateStr, {
              weekday: "short",
              day: "numeric",
              month: "short",
            })}
            {" · "}
            {TYPE_LABEL[req.type] || req.type}
          </Text>
        </View>
        <StatusTag status={req.status} />
      </View>

      <Text style={s.teamReason}>{req.reason}</Text>

      {/* What approving will write to the attendance record. */}
      <View style={s.teamAsk}>
        <Ionicons name="create-outline" size={14} color={colors.textMuted} />
        <Text style={s.teamAskText}>
          {asked || "No time or status change requested."}
        </Text>
      </View>

      {rejecting ? (
        <View style={s.section}>
          <TextInput
            value={why}
            onChangeText={setWhy}
            placeholder="Why are you rejecting this?"
            placeholderTextColor={colors.textFaint}
            accessibilityLabel="Reason for rejecting"
            multiline
            style={s.input}
          />
          <View style={s.teamBtns}>
            <InlineAction
              label="Cancel"
              tone="textMuted"
              onPress={() => {
                setRejecting(false);
                setWhy("");
              }}
            />
            <InlineAction
              label={busy ? "Rejecting…" : "Confirm reject"}
              tone="danger"
              disabled={busy}
              onPress={() => onReject(req._id, why.trim())}
            />
          </View>
        </View>
      ) : (
        <View style={s.teamBtns}>
          <InlineAction
            label="Reject"
            tone="danger"
            disabled={busy}
            onPress={() => setRejecting(true)}
          />
          <PrimaryAction
            label="Approve"
            loading={busy}
            onPress={() => onApprove(req._id)}
            style={s.teamApprove}
          />
        </View>
      )}
    </Glass>
  );
}

export default function RegularizeScreen() {
  const { apiFetch } = useAuth();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const [date, setDate] = useState(null);
  // Named `kind`, not `type`: the type SCALE is imported into this module as
  // `type`, and a state variable of that name shadows it for the whole
  // component body — every inline `type.title` would silently resolve to the
  // string "miss_punch". The wire field is still `type` (see submit()).
  const [kind, setKind] = useState("miss_punch");
  const [reason, setReason] = useState("");
  // Wall-clock strings, "HH:mm" 24-hour — the wire format the backend parses
  // against the chosen day. Never a Date: the server splits this on ":".
  const [inTime, setInTime] = useState(null);
  const [outTime, setOutTime] = useState(null);
  const [wantStatus, setWantStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const daysFetcher = useCallback(async () => {
    const res = await apiFetch(
      getApiUrl(`/attendance/monthly?month=${month}&year=${year}`),
    );
    if (!res?.success) throw new Error(res?.message || "Could not load attendance");
    return res.data || [];
  }, [apiFetch, month, year]);

  const { data: days } = useResource(`attendance:${year}-${month}`, daysFetcher);

  const reqFetcher = useCallback(async () => {
    const res = await apiFetch(getApiUrl("/regularizations"));
    if (!res?.success) throw new Error(res?.message || "Could not load requests");
    return res.data || [];
  }, [apiFetch]);

  const {
    data: requests,
    loading,
    refreshing,
    refresh,
  } = useResource("regularizations", reqFetcher);

  // ── Manager side ────────────────────────────────────────────────────────
  // A regularization filed in the app is approved in the app: the last manager
  // in the chain reaches hr_approved and the attendance row is written there
  // and then. Without this section the push that says "It's waiting on you"
  // deep-links to a screen with nothing to act on.
  //
  // The manager gate is the LEAVE module's my-team, deliberately — a manager is
  // a manager everywhere in the app, and a second team endpoint would be a
  // second thing to keep in step.
  const [section, setSection] = useState("mine");
  const [isManager, setIsManager] = useState(false);
  const [teamPending, setTeamPending] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [teamNote, setTeamNote] = useState("");

  const loadTeam = useCallback(async () => {
    const [team, queue] = await Promise.allSettled([
      apiFetch(getApiUrl(API_CONFIG.endpoints.leave.managerMyTeam)),
      apiFetch(getApiUrl(REG.managerPending)),
    ]);
    if (team.status === "fulfilled" && team.value?.success)
      setIsManager((team.value.data || []).length > 0);
    if (queue.status === "fulfilled" && queue.value?.success)
      setTeamPending(queue.value.data || []);
  }, [apiFetch]);

  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  const decide = useCallback(
    async (id, path, body, okMsg) => {
      setBusyId(id);
      setTeamNote("");
      try {
        const res = await apiFetch(getApiUrl(path), {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        if (!res?.success) {
          setTeamNote(res?.message || "Could not save that decision.");
          return;
        }
        notify("success");
        // The backend reports applied:false with a reason when the day could
        // not be written (no attendance row, a week-off, already applied). The
        // decision still stands, and the manager has to be told which it was —
        // "Approved" over a day that did not change is a lie.
        setTeamNote(res.message || okMsg);
        // Their own list can contain the same row if they filed it themselves.
        clearCache("regularizations");
        await Promise.all([loadTeam(), refresh()]);
      } catch (e) {
        setTeamNote(e?.message || "Network problem. Try again.");
      } finally {
        setBusyId(null);
      }
    },
    [apiFetch, loadTeam, refresh],
  );

  const approveReq = useCallback(
    (id) => decide(id, REG.managerApprove(id), { remarks: "" }, "Approved."),
    [decide],
  );

  const rejectReq = useCallback(
    (id, rejectionReason) =>
      decide(id, REG.managerReject(id), { rejectionReason }, "Rejected."),
    [decide],
  );

  const sectionOptions = useMemo(
    () => [
      { value: "mine", label: "Mine" },
      {
        value: "team",
        label: teamPending.length ? `Team (${teamPending.length})` : "Team",
      },
    ],
    [teamPending.length],
  );

  // Days worth offering: past days that are absent, half-day, a miss-punch, or
  // carry no status at all. A clean Present day almost never needs a fix.
  const candidates = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return (days || [])
      .filter((d) => d.dateStr && d.dateStr <= today)
      .filter((d) => {
        const st = resolveStatus(d);
        return !st || ["AB", "MP", "HD", "LHD", "LAB", "EAB"].includes(st);
      })
      .slice()
      .reverse()
      .slice(0, 12);
  }, [days]);

  const needsTimes = NEEDS_TIMES.includes(kind);
  const needsStatus = kind === "wrong_status";

  // Switching the kind of request drops whatever the previous kind collected.
  // Without this, a user who fills two times, changes their mind and picks
  // "Wrong status" silently ships the abandoned times as well, and the day
  // gets punches they never asked to add.
  useEffect(() => {
    setInTime(null);
    setOutTime(null);
    setWantStatus(null);
    setError("");
  }, [kind]);

  /**
   * The same checks the backend runs, run here so the answer is instant and
   * worded for the person reading it rather than for a log. The server still
   * enforces every one of them — this is the courtesy, not the guard.
   */
  const validate = useCallback(() => {
    if (!date) return "Pick the day you want corrected.";
    if (!reason.trim()) return "Add a short reason for your manager.";
    if (needsTimes && !inTime && !outTime)
      return "Add the IN time, the OUT time, or both.";
    // "HH:mm" is fixed-width and zero-padded, so comparing the strings is the
    // same as comparing the clock — no parsing, no timezone.
    if (inTime && outTime && inTime >= outTime)
      return "OUT time has to be after IN time.";
    if (needsStatus && !wantStatus) return "Pick what the day should have been.";
    return "";
  }, [date, reason, needsTimes, needsStatus, inTime, outTime, wantStatus]);

  const submit = useCallback(async () => {
    setError("");
    setDone("");
    const problem = validate();
    if (problem) return setError(problem);

    // Only the fields this kind of request actually asked for go on the wire.
    // Sending a stale time under "Wrong status" would have the applier write a
    // punch nobody requested.
    const body = { dateStr: date, type: kind, reason: reason.trim() };
    if (needsTimes) {
      if (inTime) body.inTime = inTime;
      if (outTime) body.outTime = outTime;
    }
    if (needsStatus) body.requestedStatus = wantStatus;

    setBusy(true);
    try {
      const res = await apiFetch(getApiUrl("/regularizations"), {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res?.success) {
        setError(res?.message || "Could not submit your request.");
        return;
      }
      notify("success");
      setDone("Sent to your manager.");
      setDate(null);
      setReason("");
      setInTime(null);
      setOutTime(null);
      setWantStatus(null);
      // The list this screen shows is now stale.
      clearCache("regularizations");
      await refresh();
    } catch (e) {
      setError(e?.message || "Network problem. Try again.");
    } finally {
      setBusy(false);
    }
  }, [
    apiFetch,
    date,
    kind,
    reason,
    inTime,
    outTime,
    wantStatus,
    needsTimes,
    needsStatus,
    validate,
    refresh,
  ]);

  return (
    <Screen
      title="Regularize"
      subtitle="If the device missed a punch or marked a day wrong, ask your manager to correct it."
      refreshing={refreshing}
      onRefresh={refresh}
    >
      {/* Only a manager ever sees a choice. For everyone else this screen is
          exactly what it was, with no empty second tab to explain. */}
      {isManager ? (
        <SegmentedToggle
          options={sectionOptions}
          value={section}
          onChange={setSection}
        />
      ) : null}

      {section === "team" && isManager ? (
        <>
          {teamNote ? (
            <Text style={s.done} accessibilityLiveRegion="polite">
              {teamNote}
            </Text>
          ) : null}
          {!teamPending.length ? (
            <Glass label="Your team">
              <Text style={s.muted}>
                Nothing waiting on you. Requests appear here the moment it is
                your turn in the chain.
              </Text>
            </Glass>
          ) : (
            teamPending.map((r) => (
              <TeamRequestCard
                key={r._id}
                req={r}
                busy={busyId === r._id}
                onApprove={approveReq}
                onReject={rejectReq}
                s={s}
                colors={colors}
              />
            ))
          )}
        </>
      ) : (
        <>
      <Glass label="Which day?">
        {/* Any past day is selectable. The previous version offered a short
            list of days it GUESSED needed fixing — but the employee knows
            which day was wrong, and a picker that hides the rest is a picker
            that cannot do its job. */}
        <Calendar
          days={days || []}
          month={month}
          year={year}
          onChangeMonth={({ month: m, year: y }) => {
            setMonth(m);
            setYear(y);
            setDate(null);
          }}
          selected={date}
          onSelectDay={(iso) => setDate(iso)}
          legend={false}
        />
        <Text style={s.picked}>
          {date ? `Selected ${formatDay(date, { day: "numeric", month: "long", year: "numeric" })}` : "Tap a day to correct it."}
        </Text>
      </Glass>

      <Glass label="What happened?">
        {/* One vertical rhythm for the whole form, expressed as `gap` on the
            group rather than marginTop on each control — otherwise the spacing
            below the error line depends on whether the error is showing. */}
        <View style={s.form}>
          <View style={s.toggles}>
            <SegmentedToggle options={REASONS_TOP} value={kind} onChange={setKind} />
            <SegmentedToggle options={REASONS_BOTTOM} value={kind} onChange={setKind} />
          </View>

          {/* ── What this kind of request needs ──────────────────────────
              Only ever one of these two blocks. A manager approving a
              correction has to know what to correct it TO, and until now the
              app asked for none of it — so every request arrived as a
              sentence somebody had to interpret by hand. */}
          {needsTimes ? (
            <View style={s.section}>
              <View style={s.timeRow}>
                <TimeField
                  label="IN time"
                  value={inTime}
                  onChange={setInTime}
                  s={s}
                  colors={colors}
                />
                <TimeField
                  label="OUT time"
                  value={outTime}
                  onChange={setOutTime}
                  s={s}
                  colors={colors}
                />
              </View>
              <Text style={s.hint}>
                Fill in whichever punch is missing. You don't need both.
              </Text>
            </View>
          ) : null}

          {needsStatus ? (
            <View style={s.section}>
              <Text style={s.fieldLabel}>What should the day have been?</Text>
              {STATUS_ROWS.map((row, i) => (
                <SegmentedToggle
                  key={i}
                  options={row}
                  value={wantStatus}
                  onChange={setWantStatus}
                />
              ))}
              <Text style={s.hint}>
                For casual, sick or privilege leave use the Leave screen instead —
                only that deducts the day from your balance.
              </Text>
            </View>
          ) : null}

          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Add a short reason"
            placeholderTextColor={colors.textFaint}
            accessibilityLabel="Reason for the correction"
            multiline
            style={s.input}
          />

          {error ? (
            <Text style={s.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          {done ? (
            <Text style={s.done} accessibilityLiveRegion="polite">
              {done}
            </Text>
          ) : null}

          {/* Disabled only on the two things every request needs. The
              type-specific rules are reported on press instead of greying the
              button out: a dead button that will not say why is the worst of
              both, and "Add the IN time, the OUT time, or both" is a sentence
              the user can act on. */}
          <PrimaryAction
            label="Send request"
            onPress={submit}
            loading={busy}
            disabled={!date || !reason.trim()}
          />
        </View>
      </Glass>

      <Glass label="Your requests" padded={false} style={s.listPanel}>
        {loading ? (
          <Text style={[s.muted, s.pad]}>Loading…</Text>
        ) : !requests?.length ? (
          <Text style={[s.muted, s.pad]}>You haven't raised any yet.</Text>
        ) : (
          requests.map((r, i) => (
            <Glass.Row key={r._id || i} first={i === 0}>
              <View style={s.reqText}>
                <Text style={s.reqDate}>
                  {formatDay(r.dateStr, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </Text>
                <Text style={s.reqReason} numberOfLines={1}>
                  {r.reason}
                </Text>
                {/* What was actually asked for, so a request is checkable
                    after the fact instead of being a date and a sentence. */}
                {askedFor(r) ? (
                  <Text style={s.reqAsk} numberOfLines={1}>
                    {askedFor(r)}
                  </Text>
                ) : null}
              </View>
              {/* Default `on="panel"` is right: these rows sit on a Glass panel. */}
              <StatusTag status={r.status} />
            </Glass.Row>
          ))
        )}
      </Glass>
        </>
      )}
    </Screen>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    // No `safe`, `scroll`, `title` or `sub` here any more — the frame, the
    // gutter, the rhythm and the page head all belong to <Screen>.
    muted: { ...type.body, color: colors.textMuted },
    picked: {
      ...type.caption,
      color: colors.textMuted,
      marginTop: spacing.snug,
      textAlign: "center",
    },
    // Glass is unpadded for the list panel, so the rows supply the gutter the
    // panel would otherwise have given them.
    pad: { paddingHorizontal: spacing.base },

    dayWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.tight },
    dayChip: {
      paddingVertical: spacing.tight,
      paddingHorizontal: spacing.snug,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
      backgroundColor: colors.inset,
      alignItems: "center",
      minWidth: 76,
    },
    dayChipText: { ...type.title, color: colors.text },
    dayChipMeta: { ...type.caption, color: colors.textFaint, marginTop: 1 },

    form: { gap: spacing.snug },
    toggles: { gap: spacing.tight },

    // A conditional block owns its own internal rhythm so the form's `gap`
    // does not have to change depending on which kind of request is showing.
    section: { gap: spacing.tight },
    fieldLabel: { ...type.caption, color: colors.textMuted },
    hint: { ...type.caption, color: colors.textFaint },

    timeRow: { flexDirection: "row", gap: spacing.tight },
    timeField: { flex: 1, gap: spacing.hair },
    timeHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      // Reserve the Clear action's height whether or not it is showing, so the
      // two fields never sit at different heights.
      minHeight: 22,
    },
    timeBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.tight,
      // `inset` is the one surface token a child of a panel may paint.
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
      paddingVertical: 11,
      paddingHorizontal: spacing.snug,
    },
    timeBtnText: { ...type.body, color: colors.text, flex: 1 },
    input: {
      ...type.body,
      color: colors.text,
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
      padding: spacing.snug,
      minHeight: 76,
      textAlignVertical: "top",
    },
    error: { ...type.caption, color: colors.danger },
    done: { ...type.caption, color: colors.success },

    // ── Manager queue ─────────────────────────────────────────────────────
    teamHead: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: spacing.tight,
    },
    teamWho: { flex: 1 },
    teamName: { ...type.title, color: colors.text },
    teamMeta: { ...type.caption, color: colors.textFaint, marginTop: 1 },
    teamReason: {
      ...type.body,
      color: colors.textMuted,
      marginTop: spacing.tight,
    },
    teamAsk: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.tight,
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
      paddingVertical: spacing.tight,
      paddingHorizontal: spacing.snug,
      marginTop: spacing.snug,
    },
    teamAskText: { ...type.caption, color: colors.text, flex: 1 },
    teamBtns: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: spacing.snug,
      marginTop: spacing.snug,
    },
    // The primary action carries the weight; Reject stays an inline word, so
    // the safe choice is not the loud one.
    teamApprove: { minWidth: 132 },

    listPanel: { paddingVertical: spacing.hair },
    reqText: { flex: 1 },
    reqDate: { ...type.title, color: colors.text },
    reqReason: { ...type.caption, color: colors.textFaint, marginTop: 1 },
    reqAsk: { ...type.caption, color: colors.textMuted, marginTop: 1 },
  });
