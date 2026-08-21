// src/screens/DocumentsScreen.js
//
// Ask HR for a letter, and open the ones that have been released to you.
//
// THE ONE THING TO UNDERSTAND ABOUT THIS PAGE: a document existing and a
// document being VISIBLE are two separate facts on the server. HR can generate
// an appointment letter months before anybody sees it. Nothing unreleased ever
// reaches this screen — not in the list, not by id — so there is deliberately
// no "pending release" state to render here and no way to discover that a
// letter already exists. If you find yourself adding a `generated` field to
// this file, the gate has been broken upstream; fix it there, not here.
//
// The server collapses its booleans into ONE employee-facing word before it
// leaves the backend (`status`), and that word is the only thing this screen
// keys on:
//
//   requested  · sent to HR, no answer yet
//   available  · released; can be opened
//   declined   · HR said no (declineReason is the sentence they wrote)
//   withdrawn  · was released, then pulled back
//   cancelled  · the employee withdrew their own ask
//
// LAYOUT: this page is a <Screen> — see the HOW TO BUILD A SCREEN block at the
// top of components/ui/Screen.js. It owns the ground, the safe area, the
// scroller, the gutter, the page head, pull-to-refresh and the nav-pill
// clearance. Nothing below sets a backgroundColor except through `colors.inset`,
// which is the one token a child of a panel is allowed to paint.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, Linking, Alert } from "react-native";
import { useAuth } from "../context/AuthContext";
import { getApiUrl, API_CONFIG } from "../lib/api";
import { useResource, clearCache } from "../lib/resource";
import { useBadges } from "../lib/badges";
import {
  Screen,
  Glass,
  PrimaryAction,
  InlineAction,
  SegmentedToggle,
} from "../components/ui";
import { tap, notify } from "../lib/feedback";
import { useTheme, radius, spacing, layout, type } from "../theme";

const DOCS = API_CONFIG.endpoints.documents;

// Five, not seven. Two types are issued BY the company and cannot be asked
// for — the backend refuses both with NOT_REQUESTABLE, and this list mirrors
// its EMPLOYEE_REQUESTABLE:
//
//   warning            nobody asks to be warned; offering it would turn the
//                      queue into a joke
//   salary_certificate the Pay tab already carries payslips, which show the
//                      same figures in more detail and need no approval.
//                      A request queue for something already downloadable is
//                      just a slower way to get it.
//
// Values are the stored enum and must stay byte-identical to the backend's
// DOC_TYPES; only the labels are ours.
const DOC_TYPES = [
  { value: "appointment", label: "Appointment" },
  { value: "offer", label: "Offer letter" },
  { value: "experience", label: "Experience" },
  { value: "relieving", label: "Relieving" },
  { value: "other", label: "Other" },
];

// Derived, so the picker and the list can never disagree about what a type is
// called. The HR-only types are added here and nowhere else: HR can issue
// either, so both must render in the list, but neither may appear in the
// picker above.
const TYPE_LABEL = {
  ...Object.fromEntries(DOC_TYPES.map((t) => [t.value, t.label])),
  warning: "Warning letter",
  salary_certificate: "Salary certificate",
};

// Rows of two rather than one row of everything: at caption size, even three
// segments across a phone truncates the longer labels to nothing readable.
// Chunked rather than hand-sliced so removing a type cannot silently drop it
// off the end of the picker.
const TYPE_ROWS = DOC_TYPES.reduce((rows, t, i) => {
  if (i % 2 === 0) rows.push([t]);
  else rows[rows.length - 1].push(t);
  return rows;
}, []);

/**
 * A stored instant, rendered as a plain day. Returns an em dash rather than the
 * string "Invalid Date" for anything unparseable — a broken timestamp must not
 * become the loudest thing on the row.
 */
function formatWhen(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** What a document is called, in the employee's list. */
function titleFor(d) {
  if (d.type === "other" && d.otherTypeLabel) return d.otherTypeLabel;
  return d.title || TYPE_LABEL[d.type] || d.type || "Document";
}

/**
 * The one line under the title.
 *
 * NO STATUS WORD for a document that is ready — the Open button already says
 * everything "Ready to open" said, and saying it twice made every usable row
 * shout its own availability. What survives is the DATE, which the button
 * cannot carry, and a real sentence for the states where there is no button
 * and the row would otherwise be unexplained.
 */
function subtitleFor(d) {
  switch (d.status) {
    case "available":
      return d.releasedAt ? `Released ${formatWhen(d.releasedAt)}` : "";
    case "requested":
      return d.requestedAt ? `Requested ${formatWhen(d.requestedAt)}` : "Requested";
    case "declined":
      return d.requestedAt ? `Requested ${formatWhen(d.requestedAt)}` : "Not approved";
    case "cancelled":
      return "You cancelled this request.";
    case "withdrawn":
      return "No longer available to open.";
    default:
      return "";
  }
}

/**
 * The extra caption a row sometimes needs, below the subtitle.
 *
 * A decline with no reason renders NOTHING rather than "No reason given" —
 * that phrasing reads as an accusation and adds no information the chip did
 * not already carry.
 */
function noteFor(d) {
  if (d.status === "declined") return (d.declineReason || "").trim();
  if (d.status === "withdrawn") return "HR has withdrawn this document.";
  return "";
}

export default function DocumentsScreen() {
  const { apiFetch } = useAuth();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { refreshBadges } = useBadges();

  // ── The request form ────────────────────────────────────────────────────
  // Named `kind`, not `type`: the typography SCALE is imported into this module
  // as `type`, and a state variable of that name shadows it for the whole
  // component body — every inline `type.title` would silently resolve to the
  // string "experience". The wire field is still `type` (see submit()).
  const [kind, setKind] = useState(null);
  const [label, setLabel] = useState(""); // only meaningful when kind === "other"
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  // Per-row busy keys. A page-wide spinner would blank a list the user is
  // still reading, and two rows can never be acted on at once anyway.
  const [openingId, setOpeningId] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const [rowNote, setRowNote] = useState("");

  // Changing the type drops the label collected for the previous one.
  // Without this, someone who types an "other" label, changes their mind and
  // picks "Relieving" silently ships the abandoned label with the request.
  useEffect(() => {
    setLabel("");
    setError("");
  }, [kind]);

  // ── The list ────────────────────────────────────────────────────────────
  const fetcher = useCallback(async () => {
    const res = await apiFetch(getApiUrl(DOCS.list));
    // Throwing rather than returning is deliberate: useResource CACHES whatever
    // the fetcher resolves with, so returning a failure payload would pin the
    // error into the store and every later mount would paint it as data.
    if (!res?.success) throw new Error(res?.message || "Could not load your documents");
    return res.data || [];
  }, [apiFetch]);

  const {
    data: docs,
    loading,
    refreshing,
    error: loadError,
    refresh,
  } = useResource("documents:mine", fetcher);

  /**
   * The same checks the backend runs, run here so the answer is instant and
   * worded for the person reading it. The server still enforces every one of
   * them — this is the courtesy, not the guard.
   */
  const validate = useCallback(() => {
    if (!kind) return "Pick which document you need.";
    if (kind === "other" && !label.trim()) return "Say which document you need.";
    return "";
  }, [kind, label]);

  const submit = useCallback(async () => {
    setError("");
    setDone("");
    const problem = validate();
    if (problem) return setError(problem);

    setBusy(true);
    try {
      const res = await apiFetch(getApiUrl(DOCS.request), {
        method: "POST",
        body: JSON.stringify({
          type: kind,
          otherTypeLabel: kind === "other" ? label.trim() : "",
          reason: reason.trim(),
        }),
      });
      if (!res?.success) {
        setError(res?.message || "Could not send your request.");
        return;
      }
      notify("success");
      setDone("Sent to HR.");
      setKind(null);
      setLabel("");
      setReason("");
      // The list this screen shows is now stale in the shared store.
      clearCache("documents");
      await refresh();
      refreshBadges?.();
    } catch (e) {
      setError(e?.message || "Network problem. Try again.");
    } finally {
      setBusy(false);
    }
  }, [apiFetch, kind, label, reason, validate, refresh, refreshBadges]);

  /**
   * Open a released document.
   *
   * The URL is fetched AT PRESS TIME rather than carried in the list payload,
   * for two reasons: the server re-checks the release gate on that call, so a
   * document withdrawn a second ago fails here instead of opening; and a stray
   * console.log of the list never carries a live link for every letter.
   *
   * Core RN `Linking` — the app has no WebView and no PDF renderer, and adding
   * either for this would be a native dependency for one row. The handset's own
   * PDF viewer or browser takes it from here.
   */
  const open = useCallback(
    async (d) => {
      tap();
      setRowNote("");
      setOpeningId(d._id);
      try {
        const res = await apiFetch(getApiUrl(DOCS.file(d._id)));
        if (!res?.success || !res.data?.fileUrl) {
          Alert.alert(
            "Not available",
            res?.message || "That document isn't available any more.",
          );
          clearCache("documents");
          await refresh();
          return;
        }
        const url = res.data.fileUrl;
        const ok = await Linking.canOpenURL(url);
        if (!ok) {
          Alert.alert("Can't open", "No app on this phone can open a PDF.");
          return;
        }
        await Linking.openURL(url);
      } catch (e) {
        Alert.alert("Couldn't open", e?.message || "Try again in a moment.");
      } finally {
        setOpeningId(null);
      }
    },
    [apiFetch, refresh],
  );

  /** Withdraw an open request. Leaves anything HR already holds untouched. */
  const cancel = useCallback(
    async (d) => {
      setRowNote("");
      setCancellingId(d._id);
      try {
        const res = await apiFetch(getApiUrl(DOCS.cancel(d._id)), {
          method: "PATCH",
          body: JSON.stringify({ reason: "" }),
        });
        if (!res?.success) {
          setRowNote(res?.message || "Could not cancel that request.");
          return;
        }
        notify("success");
        setRowNote(res.message || "Request cancelled.");
        clearCache("documents");
        await refresh();
        refreshBadges?.();
      } catch (e) {
        setRowNote(e?.message || "Network problem. Try again.");
      } finally {
        setCancellingId(null);
      }
    },
    [apiFetch, refresh, refreshBadges],
  );

  return (
    <Screen
      title="Documents"
      subtitle="Ask HR for a letter, and open the ones released to you."
      refreshing={refreshing}
      onRefresh={refresh}
    >
      <Glass label="Request a document">
        {/* One vertical rhythm for the whole form, expressed as `gap` on the
            group rather than marginTop on each control — otherwise the spacing
            below the error line depends on whether the error is showing. */}
        <View style={s.form}>
          <View style={s.toggles}>
            {TYPE_ROWS.map((row, i) => (
              <SegmentedToggle key={i} options={row} value={kind} onChange={setKind} />
            ))}
          </View>

          {kind === "other" ? (
            <View style={s.section}>
              <Text style={s.fieldLabel}>Which document?</Text>
              <TextInput
                value={label}
                onChangeText={setLabel}
                placeholder="Name the letter you need"
                placeholderTextColor={colors.textFaint}
                accessibilityLabel="Which document you need"
                maxLength={120}
                style={s.line}
              />
            </View>
          ) : null}

          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Why you need it (optional)"
            placeholderTextColor={colors.textFaint}
            accessibilityLabel="Why you need this document"
            maxLength={500}
            multiline
            style={s.input}
          />

          {error ? (
            <Text
              style={s.error}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {error}
            </Text>
          ) : null}
          {done ? (
            <Text style={s.done} accessibilityLiveRegion="polite">
              {done}
            </Text>
          ) : null}

          {/* Disabled only on the one thing every request needs. The "other"
              label rule is reported on press instead of greying the button
              out: a dead button that will not say why is the worst of both,
              and "Say which document you need" is a sentence you can act on. */}
          <PrimaryAction
            label="Send request"
            onPress={submit}
            loading={busy}
            disabled={!kind}
          />
        </View>
      </Glass>

      {rowNote ? (
        <Text style={s.done} accessibilityLiveRegion="polite">
          {rowNote}
        </Text>
      ) : null}

      <Glass label="Your documents" padded={false} style={s.listPanel}>
        {loading ? (
          <Text style={[s.muted, s.pad]}>Loading…</Text>
        ) : loadError && !docs?.length ? (
          <Text style={[s.error, s.pad]}>
            {loadError?.message || "Could not load your documents."}
          </Text>
        ) : !docs?.length ? (
          <Text style={[s.muted, s.pad]}>
            Nothing here yet. Ask HR for a letter above.
          </Text>
        ) : (
          docs.map((d, i) => {
            const note = noteFor(d);
            return (
              <Glass.Row key={d._id || i} first={i === 0}>
                <View style={s.rowText}>
                  <Text style={s.rowLabel}>{titleFor(d)}</Text>
                  {/* Guarded, not rendered empty: an empty <Text> still takes a
                      line box in RN, so an available row with no release date
                      would sit under a blank gap. */}
                  {subtitleFor(d) ? (
                    <Text style={s.rowHint} numberOfLines={1}>
                      {subtitleFor(d)}
                    </Text>
                  ) : null}
                  {note ? <Text style={s.rowNote}>{note}</Text> : null}
                </View>

                {/* Gated on the server's word, never on the presence of a file
                    object — an unreleased row carries no file at all, and a
                    released one that HR withdrew mid-session still says so. */}
                {d.status === "available" ? (
                  <InlineAction
                    label={openingId === d._id ? "Opening…" : "Open"}
                    disabled={openingId === d._id}
                    onPress={() => open(d)}
                  />
                ) : null}
                {d.status === "requested" ? (
                  <InlineAction
                    label={cancellingId === d._id ? "Cancelling…" : "Cancel"}
                    tone="danger"
                    disabled={cancellingId === d._id}
                    onPress={() => cancel(d)}
                  />
                ) : null}

                {/* No StatusTag. The action IS the status: a row with Open can
                    be opened, a row with Cancel is still pending, and the two
                    terminal states say so in words under the title. A chip
                    repeating that was noise on every single row. */}
              </Glass.Row>
            );
          })
        )}
      </Glass>
    </Screen>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    // No `safe`, `scroll`, `title` or `sub` here — the frame, the gutter, the
    // rhythm and the page head all belong to <Screen>.
    muted: { ...type.body, color: colors.textMuted },
    // The list panel is unpadded, so a bare line of text inside it has to
    // supply the gutter the panel would otherwise have given it.
    pad: { paddingHorizontal: spacing.base },

    form: { gap: spacing.snug },
    toggles: { gap: spacing.tight },
    // A conditional block owns its own internal rhythm so the form's `gap`
    // does not change depending on whether "Other" is selected.
    section: { gap: spacing.tight },
    fieldLabel: { ...type.caption, color: colors.textMuted },

    // `inset` is the one surface token a child of a panel may paint.
    line: {
      ...type.body,
      color: colors.text,
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
      paddingVertical: 11,
      paddingHorizontal: spacing.snug,
    },
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

    listPanel: { paddingVertical: spacing.hair },
    rowText: { flex: 1 },
    rowLabel: { ...type.title, color: colors.text },
    rowHint: { ...type.caption, color: colors.textFaint, marginTop: 1 },
    rowNote: { ...type.caption, color: colors.textMuted, marginTop: spacing.hair },
  });
