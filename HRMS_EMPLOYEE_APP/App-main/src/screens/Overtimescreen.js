// src/screens/Overtimescreen.js
//
// Stay-over reports and the grace time they earn.
//
// Two audiences on one page: an employee submitting a report for a day the
// device recorded them leaving late, and a manager approving their team's.
// `section` switches between them, and the Team side only exists at all when
// /leave-applications/manager/my-team comes back non-empty.
//
// Migrated onto the shared layout: <Screen> owns the ground, the safe area,
// the scroller, the gutter, the rhythm and the nav-pill clearance. This file
// sets no backgroundColor and declares no tab clearance — see the HOW TO BUILD
// A SCREEN block at the top of components/ui/Screen.js, in particular rule 3:
// a child of a panel paints `colors.inset` and never a panel token.
//
// The one deliberate exception is SubmitSheet's overlay, which paints
// `colors.scrim`. A scrim is a full-screen dimmer, not a surface — it cannot
// produce a region split — and the sheet itself is a <Glass strong>, so no
// colour is hard-coded there either.

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { useAuth } from "../context/AuthContext";
import { useBadges } from "../lib/badges";
import { getApiUrl } from "../lib/api";
import {
  Screen,
  Glass,
  StatusTag,
  Avatar,
  PrimaryAction,
  SecondaryAction,
  InlineAction,
  SegmentedToggle,
} from "../components/ui";
import { useTheme, radius, spacing, layout, type } from "../theme";

const fmtDate = (s) => {
  if (!s) return "—";
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

function formatTime24to12(t) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
}

const fmtSpan = (mins) => `${Math.floor(mins / 60)}h ${mins % 60}m`;

// Mirrors the backend's isOvertimeExpired — cutoff is 12:00 PM IST the day
// AFTER the stay-over. 12:00 IST = 06:30 UTC. Used to defensively hide
// expired pending entries on the client (the backend /check already filters
// them, but cached screen state may still have them).
function isOTExpiredClient(dateStr) {
  if (!dateStr) return false;
  const [y, m, d] = String(dateStr).split("-").map(Number);
  if (!y || !m || !d) return false;
  const cutoffUtcMs = Date.UTC(y, m - 1, d + 1, 6, 30, 0, 0);
  return Date.now() >= cutoffUtcMs;
}

// The overtime flow's own status vocabulary. It deliberately does NOT use the
// shared STATUS_LABELS map: there, `manager_approved` means "under review"
// because a leave application still needs HR. An overtime report does not —
// the manager's approval is final, so the label stays "Approved".
const OT_STATUS = {
  pending: { label: "Pending", tone: "warning" },
  manager_approved: { label: "Approved", tone: "success" },
  manager_rejected: { label: "Rejected", tone: "danger" },
  expired: { label: "Expired", tone: "textFaint" },
};

function OTStatusTag({ status, on }) {
  const meta = OT_STATUS[status] || OT_STATUS.pending;
  return <StatusTag label={meta.label} tone={meta.tone} on={on} />;
}

/**
 * Earned grace, tinted by how much of it there is. A state chip, so it is a
 * StatusTag rather than a hand-rolled pill — the tint is mixed against the
 * surface it sits on instead of washed over it.
 */
function GraceBadge({ minutes, on = "panel" }) {
  if (!minutes) return null;
  const tone = minutes >= 60 ? "danger" : minutes >= 30 ? "warning" : "success";
  return <StatusTag label={`+${minutes} min grace`} tone={tone} on={on} />;
}

/** A small labelled value inside an inset strip. */
function Stat({ label, value, tone, children, style }) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[s.stat, style]}>
      <Text style={s.statLabel}>{label}</Text>
      {children ?? (
        <Text style={[s.statValue, tone ? { color: colors[tone] || tone } : null]}>
          {value}
        </Text>
      )}
    </View>
  );
}

/**
 * A destructive commit inside a panel. Paints `inset` (rule 3) and carries the
 * danger tone on its border, icon and label — a solid danger fill at this size
 * reads as the primary action, which reject is not.
 */
function DangerAction({ label, icon, onPress, disabled, style }) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      activeOpacity={0.8}
      disabled={disabled}
      onPress={onPress}
      style={[s.dangerAction, disabled && s.dimmed, style]}
    >
      {icon}
      <Text style={s.dangerActionText}>{label}</Text>
    </TouchableOpacity>
  );
}

function EmptyState({ icon, iconTone, title, message }) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={s.emptyBox}>
      <Ionicons name={icon} size={40} color={colors[iconTone] || colors.textFaint} />
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyMsg}>{message}</Text>
    </View>
  );
}

// ── Pending Stay-Over Card (Employee needs to submit) ──
function PendingOTCard({ item, onSubmit }) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  return (
    // `strong` plus a warning border: this is the one card on the page the
    // employee has to act on, so it sits forward of the history behind it.
    <Glass strong style={{ borderColor: colors.warning }}>
      <View style={s.cardHeader}>
        <View style={s.iconWell}>
          <Ionicons name="alert-circle" size={24} color={colors.warning} />
        </View>
        <View style={s.flex}>
          <Text style={s.cardTitle}>Overtime Report Required</Text>
          <Text style={s.cardMeta}>{fmtDate(item.dateStr)}</Text>
        </View>
      </View>

      <View style={s.statStrip}>
        <Stat
          label="Scheduled Out"
          value={formatTime24to12(item.scheduledOutTime)}
        />
        <Ionicons name="arrow-forward" size={14} color={colors.textFaint} />
        <Stat
          label="Actual Out"
          value={formatTime24to12(item.actualOutTime)}
          tone="warning"
        />
        <Stat label="Extra" value={fmtSpan(item.stayOverMins)} />
      </View>

      <GraceBadge minutes={item.graceMinutes} on="panelStrong" />

      {item.graceMinutes > 0 && (
        <Text style={s.graceNote}>
          If approved, you can report by{" "}
          <Text style={s.graceNoteStrong}>
            {formatTime24to12(item.adjustedReportTime)}
          </Text>{" "}
          tomorrow instead of 9:30 AM
        </Text>
      )}

      <PrimaryAction
        label="Submit Report"
        onPress={() => onSubmit(item)}
        style={s.cardCommit}
        icon={
          <Ionicons
            name="document-text-outline"
            size={18}
            color={colors.onHero}
          />
        }
      />
    </Glass>
  );
}

// ── Manager Approval Card ──
function ManagerOTCard({ report, onApprove, onReject, busy }) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [expanded, setExpanded] = useState(false);
  const name = report.employeeName || "—";

  return (
    <Glass>
      <View style={s.cardHeader}>
        <Avatar name={name} size={42} />
        <View style={s.flex}>
          <Text style={s.cardTitle}>{name}</Text>
          <Text style={s.cardMeta}>
            {report.department || ""} · {fmtDate(report.dateStr)}
          </Text>
        </View>
        <GraceBadge minutes={report.graceMinutes} on="panel" />
      </View>

      <View style={s.statStrip}>
        <Stat label="Out Time" value={formatTime24to12(report.actualOutTime)} />
        <Stat label="Extra Time" value={fmtSpan(report.stayOverMins)} />
        <Stat
          label="Grace"
          value={`+${report.graceMinutes}m`}
          tone="success"
        />
      </View>

      <InlineAction
        label={expanded ? "Hide details" : "View report & proof"}
        onPress={() => setExpanded(!expanded)}
        style={s.detailsToggle}
      />

      {expanded && (
        <View style={s.insetBox}>
          <Text style={s.insetLabel}>What they worked on:</Text>
          <Text style={s.insetText}>{report.description || "No description"}</Text>
          {report.documentUrl ? (
            <View style={s.docRow}>
              <Ionicons name="document-attach" size={14} color={colors.success} />
              <Text style={[s.docText, { color: colors.success }]}>
                Proof attached
              </Text>
            </View>
          ) : (
            <View style={s.docRow}>
              <Ionicons
                name="alert-circle-outline"
                size={14}
                color={colors.warning}
              />
              <Text style={[s.docText, { color: colors.warning }]}>
                No proof attached
              </Text>
            </View>
          )}
        </View>
      )}

      <View style={s.actionRow}>
        <DangerAction
          label="Reject"
          disabled={!!busy}
          onPress={() => onReject(report._id)}
          style={s.flex}
          icon={<Ionicons name="close-outline" size={16} color={colors.danger} />}
        />
        <PrimaryAction
          label="Approve"
          loading={!!busy}
          disabled={!!busy}
          onPress={() => onApprove(report._id)}
          style={s.flex}
          icon={
            <Ionicons name="checkmark-outline" size={16} color={colors.onHero} />
          }
        />
      </View>
    </Glass>
  );
}

// ── One row of the employee's own history ──
function HistoryRow({ report, first }) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Glass.Row first={first} style={s.historyRow}>
      <View style={s.historyHead}>
        <Text style={s.cardTitle}>{fmtDate(report.dateStr)}</Text>
        <OTStatusTag status={report.status} on="panel" />
      </View>

      <View style={s.historyStats}>
        <Stat label="Out" value={formatTime24to12(report.actualOutTime)} />
        <Stat label="Extra" value={fmtSpan(report.stayOverMins)} />
        <Stat label="Grace" value={`+${report.graceMinutes}m`} tone="success" />
        {report.graceApplied ? (
          <Stat label="Applied">
            <Ionicons
              name="checkmark-circle"
              size={16}
              color={colors.success}
              style={s.appliedIcon}
            />
          </Stat>
        ) : null}
      </View>

      {report.description ? (
        <Text style={s.historyDesc} numberOfLines={2}>
          {report.description}
        </Text>
      ) : null}

      {report.rejectionReason ? (
        <View style={s.rejBox}>
          <Ionicons name="close-circle" size={14} color={colors.danger} />
          <Text style={s.rejText}>{report.rejectionReason}</Text>
        </View>
      ) : null}
    </Glass.Row>
  );
}

// ── Submit Report Sheet ──
function SubmitSheet({ visible, onClose, item, onSuccess, apiFetch }) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [description, setDescription] = useState("");
  const [pickedFile, setPickedFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!visible || !item) return null;

  const pickImage = async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });
      if (!r.canceled && r.assets?.[0])
        setPickedFile({
          uri: r.assets[0].uri,
          name: `proof_${Date.now()}.jpg`,
          mimeType: "image/jpeg",
        });
    } catch {}
  };

  const pickDoc = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
        copyToCacheDirectory: true,
      });
      if (!r.canceled && r.assets?.[0])
        setPickedFile({
          uri: r.assets[0].uri,
          name: r.assets[0].name,
          mimeType: r.assets[0].mimeType || "application/pdf",
        });
    } catch {}
  };

  const handleSubmit = async () => {
    if (!description.trim()) {
      setError("Please describe what you worked on");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const token = await SecureStore.getItemAsync("employee_token").catch(
        () => null,
      );
      const fd = new FormData();
      fd.append("dateStr", item.dateStr);
      fd.append("description", description.trim());
      if (pickedFile)
        fd.append("document", {
          uri: pickedFile.uri,
          name: pickedFile.name,
          type: pickedFile.mimeType,
        });

      const res = await fetch(getApiUrl("/overtime/submit"), {
        method: "POST",
        headers: {
          ...(token
            ? {
                Authorization: `Bearer ${token}`,
                Cookie: `employee_token=${token}`,
              }
            : {}),
        },
        credentials: "include",
        body: fd,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Submit failed");

      onSuccess(data.message || "Report submitted!");
      setDescription("");
      setPickedFile(null);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      {/* A scrim is a dimmer, not a surface — it covers the whole screen, so
          it cannot split a region into two tones. */}
      <View style={s.sheetOverlay}>
        <TouchableOpacity style={s.flex} activeOpacity={1} onPress={onClose} />

        <Glass strong padded={false} style={s.sheet}>
          <View style={s.handleWrap}>
            <View style={s.handle} />
          </View>

          <ScrollView style={s.sheetScroll} showsVerticalScrollIndicator={false}>
            <View style={s.sheetBody}>
              <View style={s.cardHeader}>
                <View style={s.iconWell}>
                  <Ionicons name="document-text" size={22} color={colors.warning} />
                </View>
                <View style={s.flex}>
                  <Text style={s.cardTitle}>Overtime Report</Text>
                  <Text style={s.cardMeta}>
                    {fmtDate(item.dateStr)} · Stayed until{" "}
                    {formatTime24to12(item.actualOutTime)}
                  </Text>
                </View>
              </View>

              <View style={s.sheetStats}>
                <Stat label="Extra time" value={fmtSpan(item.stayOverMins)} />
                <View style={s.divider} />
                <Stat
                  label="Grace earned"
                  value={`+${item.graceMinutes} min`}
                  tone="success"
                />
                <View style={s.divider} />
                <Stat
                  label="Report by"
                  value={formatTime24to12(item.adjustedReportTime)}
                />
              </View>

              <View>
                <Text style={s.formLabel}>What did you work on? *</Text>
                <TextInput
                  style={s.formInput}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Describe the tasks you completed during overtime..."
                  placeholderTextColor={colors.textFaint}
                  multiline
                  numberOfLines={4}
                />
              </View>

              <View>
                <Text style={s.formLabel}>Proof / Screenshot (optional)</Text>
                {pickedFile ? (
                  <View style={s.filePickedRow}>
                    <Ionicons
                      name={
                        pickedFile.mimeType?.includes("image")
                          ? "image"
                          : "document"
                      }
                      size={20}
                      color={colors.success}
                    />
                    <Text style={s.filePickedName} numberOfLines={1}>
                      {pickedFile.name}
                    </Text>
                    <TouchableOpacity onPress={() => setPickedFile(null)}>
                      <Ionicons
                        name="close-circle"
                        size={20}
                        color={colors.textFaint}
                      />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={s.pickRow}>
                    <SecondaryAction
                      label="Photo"
                      onPress={pickImage}
                      style={s.flex}
                      icon={
                        <Ionicons
                          name="camera-outline"
                          size={18}
                          color={colors.text}
                        />
                      }
                    />
                    <SecondaryAction
                      label="File"
                      onPress={pickDoc}
                      style={s.flex}
                      icon={
                        <Ionicons
                          name="attach-outline"
                          size={18}
                          color={colors.text}
                        />
                      }
                    />
                  </View>
                )}
              </View>

              {error ? (
                <View style={s.errorBox}>
                  <Text style={s.errorText}>{error}</Text>
                </View>
              ) : null}

              <PrimaryAction
                label="Submit Report"
                onPress={handleSubmit}
                loading={!!loading}
                disabled={!!loading}
              />
            </View>
          </ScrollView>
        </Glass>
      </View>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
export default function OvertimeScreen() {
  const { user, apiFetch } = useAuth();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const { refreshBadges } = useBadges();
  const [pendingOT, setPendingOT] = useState([]);
  const [myReports, setMyReports] = useState([]);
  const [mgrPending, setMgrPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState("");
  const [submitItem, setSubmitItem] = useState(null);
  const [section, setSection] = useState("my"); // "my" | "team"
  const [isManager, setIsManager] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const fetchAll = useCallback(async () => {
    try {
      const [check, my, team, mgr] = await Promise.allSettled([
        apiFetch(getApiUrl("/overtime/check")),
        apiFetch(getApiUrl("/overtime/my")),
        apiFetch(getApiUrl("/leave-applications/manager/my-team")),
        apiFetch(getApiUrl("/overtime/manager/pending")),
      ]);
      if (check.status === "fulfilled" && check.value.success)
        setPendingOT(check.value.data || []);
      if (my.status === "fulfilled" && my.value.success)
        setMyReports(my.value.data || []);
      if (team.status === "fulfilled" && team.value.success)
        setIsManager((team.value.data || []).length > 0);
      if (mgr.status === "fulfilled" && mgr.value.success)
        setMgrPending(mgr.value.data || []);
    } catch (_) {
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  };

  /**
   * OPTIMISTIC — same shape as the leave approvals. The row leaves the list on
   * tap and the request follows; on failure the row is restored and the error
   * shown, so a server rejection can never be silently swallowed.
   */
  const handleApprove = async (id) => {
    const snapshot = mgrPending;
    setMgrPending((list) => list.filter((r) => r._id !== id));
    showToast("Approved");

    try {
      await apiFetch(getApiUrl(`/overtime/manager/${id}/approve`), {
        method: "PATCH",
        body: JSON.stringify({ remarks: "" }),
      });
      fetchAll();
      refreshBadges?.();
    } catch (e) {
      setMgrPending(snapshot);
      Alert.alert("Could not approve", e.message);
    }
  };

  const handleReject = async (id) => {
    Alert.prompt
      ? Alert.prompt("Reject", "Reason?", [
          { text: "Cancel", style: "cancel" },
          {
            text: "Reject",
            style: "destructive",
            onPress: async (reason) => {
              const snapshot = mgrPending;
              setMgrPending((list) => list.filter((r) => r._id !== id));
              try {
                await apiFetch(getApiUrl(`/overtime/manager/${id}/reject`), {
                  method: "PATCH",
                  body: JSON.stringify({ remarks: reason || "" }),
                });
                showToast("Rejected");
                fetchAll();
              } catch (e) {
                setMgrPending(snapshot);
                Alert.alert("Could not reject", e.message);
              }
            },
          },
        ])
      : (async () => {
          setBusyId(id);
          try {
            await apiFetch(getApiUrl(`/overtime/manager/${id}/reject`), {
              method: "PATCH",
              body: JSON.stringify({ remarks: "" }),
            });
            showToast("Rejected");
            fetchAll();
          } catch (e) {
            Alert.alert("Error", e.message);
          } finally {
            setBusyId(null);
          }
        })();
  };

  // Pending submissions — filter out expired entries defensively. The backend's
  // /check already applies the 12:00 IST next-day cutoff; this covers cached
  // screen state that predates it.
  const visiblePending = useMemo(
    () => pendingOT.filter((p) => !isOTExpiredClient(p.dateStr)),
    [pendingOT],
  );

  const sectionOptions = useMemo(
    () => [
      { value: "my", label: "My Reports" },
      {
        value: "team",
        label: mgrPending.length > 0 ? `Team (${mgrPending.length})` : "Team",
      },
    ],
    [mgrPending.length],
  );

  if (loading)
    return (
      <Screen
        title="Overtime"
        subtitle="Stay-over reports & grace time"
        scroll={false}
      >
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </Screen>
    );

  return (
    <>
      <Screen
        title="Overtime"
        subtitle="Stay-over reports & grace time"
        refreshing={refreshing}
        onRefresh={onRefresh}
        // The toast rides in the footer slot: pinned above the nav pill, so a
        // confirmation cannot scroll away before it is read.
        footer={
          toast ? (
            <View style={s.toast}>
              <Text style={s.toastText}>{toast}</Text>
            </View>
          ) : null
        }
      >
        {isManager && (
          <SegmentedToggle
            options={sectionOptions}
            value={section}
            onChange={setSection}
          />
        )}

        {section === "my" && (
          <>
            {visiblePending.length > 0 ? (
              <Screen.Section title="Action required">
                {visiblePending.map((item, i) => (
                  <PendingOTCard key={i} item={item} onSubmit={setSubmitItem} />
                ))}
              </Screen.Section>
            ) : null}

            <Screen.Section title="My reports">
              {myReports.length === 0 ? (
                <EmptyState
                  icon="time-outline"
                  iconTone="textFaint"
                  title="No overtime reports"
                  message="When you stay late, submit a report here"
                />
              ) : (
                <Glass padded={false} style={s.listPanel}>
                  {myReports.map((r, i) => (
                    <HistoryRow key={r._id} report={r} first={i === 0} />
                  ))}
                </Glass>
              )}
            </Screen.Section>
          </>
        )}

        {section === "team" && isManager && (
          <Screen.Section title="Pending approval">
            {mgrPending.length === 0 ? (
              <EmptyState
                icon="checkmark-circle"
                iconTone="success"
                title="All caught up!"
                message="No overtime reports to review"
              />
            ) : (
              mgrPending.map((r) => (
                <ManagerOTCard
                  key={r._id}
                  report={r}
                  busy={busyId === r._id}
                  onApprove={handleApprove}
                  onReject={handleReject}
                />
              ))
            )}
          </Screen.Section>
        )}
      </Screen>

      <SubmitSheet
        visible={!!submitItem}
        item={submitItem}
        onClose={() => setSubmitItem(null)}
        onSuccess={(msg) => {
          // Optimistic UI — remove the just-submitted item from the pending
          // list immediately so the card disappears before fetchAll's network
          // round-trips finish (which can be 30-60s on a Render cold start).
          if (submitItem?.dateStr) {
            setPendingOT((prev) =>
              prev.filter((p) => p.dateStr !== submitItem.dateStr),
            );
          }
          showToast(msg);
          // Background refresh — keeps history + manager tab in sync but
          // doesn't block the UI on the response.
          fetchAll();
        }}
        apiFetch={apiFetch}
      />
    </>
  );
}

// No `safe`, `scroll`, `header` or TAB_CLEARANCE here any more — the frame, the
// gutter, the rhythm, the page head and the nav-pill clearance all belong to
// <Screen>. Every colour comes through `colors`, so a stale StyleSheet cannot
// pin a light-mode value into dark mode.
const makeStyles = (colors) =>
  StyleSheet.create({
    flex: { flex: 1 },
    dimmed: { opacity: 0.4 },
    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

    // ── Shared card furniture ──────────────────────────────────────────────
    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.snug,
      marginBottom: spacing.snug,
    },
    iconWell: {
      width: 44,
      height: 44,
      borderRadius: radius.control,
      backgroundColor: colors.inset,
      alignItems: "center",
      justifyContent: "center",
    },
    cardTitle: { ...type.title, color: colors.text },
    cardMeta: { ...type.caption, color: colors.textMuted, marginTop: 2 },
    cardCommit: { marginTop: spacing.snug },

    // ── The inset stat strip ───────────────────────────────────────────────
    // `inset` is the ONLY surface a child of a panel may paint. Painting
    // colors.glass here is the two-tone artifact.
    statStrip: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
      paddingHorizontal: spacing.snug,
      paddingVertical: spacing.tight,
      marginBottom: spacing.tight,
    },
    stat: { alignItems: "center" },
    statLabel: { ...type.label, color: colors.textFaint },
    statValue: { ...type.title, color: colors.text, marginTop: 2 },

    graceNote: {
      ...type.caption,
      color: colors.textMuted,
      lineHeight: 17,
      marginTop: spacing.tight,
    },
    graceNoteStrong: { ...type.title, color: colors.text },

    // ── Manager card ───────────────────────────────────────────────────────
    detailsToggle: { alignSelf: "flex-start", marginTop: spacing.hair },
    insetBox: {
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
      padding: spacing.snug,
      marginTop: spacing.tight,
      gap: spacing.hair,
    },
    insetLabel: { ...type.caption, color: colors.textMuted },
    insetText: { ...type.body, color: colors.text },
    docRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.hair,
      marginTop: spacing.hair,
    },
    docText: { ...type.caption, flex: 1 },

    actionRow: { flexDirection: "row", gap: spacing.snug, marginTop: spacing.snug },
    dangerAction: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.tight,
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.danger,
      paddingVertical: 15,
      paddingHorizontal: spacing.base,
    },
    dangerActionText: { ...type.title, color: colors.danger },

    // ── History list ───────────────────────────────────────────────────────
    listPanel: { paddingVertical: spacing.hair },
    historyRow: {
      flexDirection: "column",
      alignItems: "stretch",
      paddingHorizontal: spacing.base,
      gap: spacing.tight,
    },
    historyHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.tight,
    },
    historyStats: { flexDirection: "row", gap: spacing.base },
    appliedIcon: { marginTop: 3 },
    historyDesc: { ...type.caption, color: colors.textMuted, lineHeight: 17 },
    rejBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.hair,
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
      padding: spacing.snug,
    },
    rejText: { ...type.caption, color: colors.danger, flex: 1 },

    // ── Empty ──────────────────────────────────────────────────────────────
    emptyBox: { alignItems: "center", paddingVertical: spacing.section },
    emptyTitle: { ...type.title, color: colors.text, marginTop: spacing.tight },
    emptyMsg: { ...type.caption, color: colors.textMuted, marginTop: spacing.hair },

    // ── Toast ──────────────────────────────────────────────────────────────
    // `ink` is a top-level surface on the ground, not a child of a panel.
    toast: {
      backgroundColor: colors.ink,
      borderRadius: radius.control,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.snug,
    },
    toastText: { ...type.caption, color: colors.onInk, textAlign: "center" },

    // ── Submit sheet ───────────────────────────────────────────────────────
    sheetOverlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: colors.scrim,
    },
    sheet: {
      maxHeight: "85%",
      borderRadius: 0,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
    },
    handleWrap: { alignItems: "center", paddingTop: spacing.tight },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.inset,
    },
    sheetScroll: { paddingHorizontal: spacing.base },
    sheetBody: { paddingVertical: spacing.base, gap: spacing.base },
    sheetStats: {
      flexDirection: "row",
      justifyContent: "space-around",
      alignItems: "center",
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
      padding: spacing.snug,
    },
    divider: { width: layout.hairlineWidth, alignSelf: "stretch", backgroundColor: colors.hairline },

    formLabel: { ...type.caption, color: colors.textMuted, marginBottom: spacing.hair },
    formInput: {
      ...type.body,
      color: colors.text,
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.insetBorder,
      paddingHorizontal: spacing.snug,
      paddingVertical: spacing.snug,
      height: 100,
      textAlignVertical: "top",
    },
    filePickedRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.tight,
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.success,
      padding: spacing.snug,
    },
    filePickedName: { ...type.caption, color: colors.success, flex: 1 },
    pickRow: { flexDirection: "row", gap: spacing.tight },

    errorBox: {
      backgroundColor: colors.inset,
      borderRadius: radius.control,
      borderWidth: layout.hairlineWidth,
      borderColor: colors.danger,
      padding: spacing.snug,
    },
    errorText: { ...type.caption, color: colors.danger },
  });
