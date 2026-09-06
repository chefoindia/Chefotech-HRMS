import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { format, isBefore, parseISO } from "date-fns";
import { useApplyLeave, useLeaveBalances, useLeavePreview, type LeavePreview } from "../../src/api/hooks";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, Field, Loading, Txt } from "../../src/components/ui";
import { Chips } from "../../src/components/ScreenHeader";
import { Note } from "../../src/components/Sheet";
import { radius, spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";
import { ApiError } from "../../src/api/client";
import { TourTarget } from "../../src/help/TourEngine";
import { DatePickerSheet } from "../../src/components/DatePickerSheet";
import { dateLabel } from "../../src/lib/format";

/**
 * Applying for leave.
 *
 * The cost is fetched from the server — the same engine that will do the
 * real deduction — and shown line by line with the rule that produced it,
 * before the submit button is even enabled. Identical to the web dialog.
 */
export default function ApplyLeave() {
  const colors = useColors();
  const router = useRouter();
  const toast = useToast();

  const balances = useLeaveBalances();
  const preview = useLeavePreview();
  const apply = useApplyLeave();

  const [leaveTypeId, setLeaveTypeId] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [fromPortion, setFromPortion] = useState("full");
  const [toPortion, setToPortion] = useState("full");
  const [reason, setReason] = useState("");
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [result, setResult] = useState<LeavePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const eligible = useMemo(() => (balances.data ?? []).filter((b) => b.eligible), [balances.data]);
  const selected = useMemo(() => eligible.find((b) => b.leaveType.id === leaveTypeId), [eligible, leaveTypeId]);
  const singleDay = fromDate === toDate;

  // Default to whichever type they actually have days in, so the common case
  // needs no selection at all.
  useEffect(() => {
    if (!leaveTypeId && eligible.length) {
      const withDays = eligible.find((b) => (b.available ?? 0) > 0);
      setLeaveTypeId((withDays ?? eligible[0]).leaveType.id);
    }
  }, [eligible, leaveTypeId]);

  const onFromChange = (value: string) => {
    setFromDate(value);
    if (isBefore(parseISO(toDate), parseISO(value))) setToDate(value);
  };

  const runPreview = useCallback(async () => {
    if (!leaveTypeId || !fromDate || !toDate || fromDate > toDate) return;
    setPreviewError(null);
    try {
      const response = await preview.mutateAsync({ leaveTypeId, fromDate, toDate, fromPortion, toPortion: singleDay ? "full" : toPortion });
      setResult(response.data);
    } catch (error) {
      setResult(null);
      setPreviewError(error instanceof ApiError ? error.message : "Could not work out the cost of these dates.");
    }
    // `preview` is a stable mutation object from React Query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaveTypeId, fromDate, toDate, fromPortion, toPortion, singleDay]);

  useEffect(() => {
    const timer = setTimeout(runPreview, 300);
    return () => clearTimeout(timer);
  }, [runPreview]);

  const submit = async () => {
    setFieldErrors({});
    if (!leaveTypeId) return setFieldErrors({ leaveTypeId: "Choose a leave type." });
    if (!reason.trim()) return setFieldErrors({ reason: "Give a short reason — your manager sees it." });
    try {
      await apply.mutateAsync({ leaveTypeId, fromDate, toDate, fromPortion, toPortion: singleDay ? "full" : toPortion, reason: reason.trim() });
      toast.success("Leave applied. Your manager has been notified.");
      router.replace("/(app)/leave");
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors);
        toast.error(error.message);
      } else toast.error("Could not submit that request.");
    }
  };

  const daysOff = (result?.days || []).filter((d) => d.isHoliday || d.isWeeklyOff);
  const canSubmit = Boolean(result?.canApply) && reason.trim().length > 0 && fromDate <= toDate;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", padding: spacing.lg }}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Txt variant="heading" style={{ marginLeft: spacing.sm }}>
          Apply for leave
        </Txt>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={80}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["4xl"] }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TourTarget id="leave-type">
            <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>
              Leave type
            </Txt>
            {balances.isLoading ? (
              <Loading />
            ) : eligible.length === 0 ? (
              <Card>
                <Txt variant="body" tone="muted">
                  No leave types are available to you yet. Ask HR to assign a leave policy to your profile.
                </Txt>
              </Card>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {eligible.map((balance) => {
                  const active = balance.leaveType.id === leaveTypeId;
                  return (
                    <Pressable
                      key={balance.leaveType.id}
                      onPress={() => setLeaveTypeId(balance.leaveType.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      style={{ flexDirection: "row", alignItems: "center", padding: spacing.lg, borderRadius: radius.md, borderWidth: active ? 2 : 1, borderColor: active ? colors.brand[600] : colors.border, backgroundColor: active ? colors.brand[50] : colors.surface }}
                    >
                      <Ionicons name={active ? "radio-button-on" : "radio-button-off"} size={19} color={active ? colors.brand[600] : colors.textSubtle} />
                      <Txt variant="bodyMedium" style={{ flex: 1, marginLeft: spacing.md }}>
                        {balance.leaveType.name}
                      </Txt>
                      {balance.hasBalance ? <Badge label={`${balance.available ?? 0} left`} tone={(balance.available ?? 0) > 0 ? "success" : "danger"} /> : <Badge label="No limit" tone="neutral" />}
                    </Pressable>
                  );
                })}
              </View>
            )}
            {fieldErrors.leaveTypeId && (
              <Txt variant="caption" tone="danger" style={{ marginTop: 6 }}>
                {fieldErrors.leaveTypeId}
              </Txt>
            )}
          </TourTarget>

          <TourTarget id="leave-dates">
            <Txt variant="label" tone="muted" style={{ marginTop: spacing.xl, marginBottom: 6 }}>
              Dates
            </Txt>
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <DateButton label="From" value={fromDate} onPress={() => setPicking("from")} />
              <DateButton label="To" value={toDate} onPress={() => setPicking("to")} />
            </View>
          </TourTarget>

          {selected?.leaveType.allowHalfDay && (
            <View style={{ marginTop: spacing.lg }}>
              <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>
                {singleDay ? "Portion of the day" : "First day"}
              </Txt>
              <Chips
                options={[
                  { value: "full", label: "Full day" },
                  { value: "first_half", label: "First half" },
                  { value: "second_half", label: "Second half" },
                ]}
                value={fromPortion}
                onChange={setFromPortion}
              />
              {!singleDay && (
                <>
                  <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>
                    Last day
                  </Txt>
                  <Chips
                    options={[
                      { value: "full", label: "Full day" },
                      { value: "first_half", label: "First half" },
                    ]}
                    value={toPortion}
                    onChange={setToPortion}
                  />
                </>
              )}
            </View>
          )}

          {/* The preview */}
          <TourTarget id="leave-preview">
            <View style={{ marginTop: spacing.xl }}>
              {fromDate > toDate ? (
                <Note tone="warning">The end date must be on or after the start date.</Note>
              ) : preview.isPending && !result ? (
                <Card>
                  <Loading label="Working out the cost…" />
                </Card>
              ) : previewError ? (
                <Card style={{ backgroundColor: colors.dangerBg, borderColor: colors.danger }}>
                  <Txt variant="label" tone="danger" style={{ lineHeight: 19 }}>
                    {previewError}
                  </Txt>
                </Card>
              ) : result ? (
                <Card style={{ backgroundColor: result.canApply ? colors.surface : colors.warningBg, borderColor: result.canApply ? colors.border : colors.warning }}>
                  <Txt variant="caption" tone="subtle" style={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
                    This request costs
                  </Txt>
                  <View style={{ flexDirection: "row", alignItems: "baseline" }}>
                    <Txt variant="display">{result.leaveDays}</Txt>
                    <Txt variant="body" tone="muted" style={{ marginLeft: 6 }}>
                      {result.leaveDays === 1 ? "day" : "days"} across {result.calendarDays} calendar {result.calendarDays === 1 ? "day" : "days"}
                    </Txt>
                  </View>
                  {result.balanceAvailable !== null && (
                    <Txt variant="label" style={{ marginTop: spacing.sm }}>
                      Balance after: {result.balanceAfter}{" "}
                      <Txt variant="caption" tone="muted">
                        (from {result.balanceAvailable})
                      </Txt>
                    </Txt>
                  )}

                  {result.breakdown.length > 0 && (
                    <View style={{ marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
                      <Txt variant="caption" tone="subtle" style={{ textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
                        How that was worked out
                      </Txt>
                      {result.breakdown.map((entry, index) => (
                        <View key={index} style={{ flexDirection: "row", gap: spacing.sm, marginTop: 3 }}>
                          <Txt variant="caption" tone="muted" style={{ flex: 1, lineHeight: 18 }}>
                            {entry.detail}
                          </Txt>
                          <Txt variant="caption" style={{ lineHeight: 18 }}>
                            {entry.effect}
                          </Txt>
                        </View>
                      ))}
                    </View>
                  )}

                  {daysOff.length > 0 && (
                    <View style={{ marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
                      <Txt variant="caption" tone="subtle" style={{ textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
                        Days off inside your dates
                      </Txt>
                      {daysOff.map((day) => (
                        <View key={day.date} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
                          <Ionicons name={day.deductedDays > 0 ? "alert-circle-outline" : "checkmark-circle-outline"} size={14} color={day.deductedDays > 0 ? colors.warning : colors.success} />
                          <Txt variant="caption" style={{ color: day.deductedDays > 0 ? colors.warning : colors.success }}>
                            {dateLabel(day.date, "EEE d MMM")}
                          </Txt>
                          <Txt variant="caption" tone="muted" style={{ flex: 1, textAlign: "right" }}>
                            {day.reason}
                          </Txt>
                        </View>
                      ))}
                    </View>
                  )}

                  {result.attachmentRequired && (
                    <View style={{ marginTop: spacing.md }}>
                      <Note tone="info">A supporting document is required for a request of this length. Upload it from Documents once submitted.</Note>
                    </View>
                  )}
                  {result.problems.length > 0 && (
                    <View style={{ marginTop: spacing.md }}>
                      <Note tone="warning">{result.problems.join("\n")}</Note>
                    </View>
                  )}
                </Card>
              ) : (
                <Card>
                  <Txt variant="body" tone="muted">
                    Choose a leave type and dates to see how many days will be deducted.
                  </Txt>
                </Card>
              )}
            </View>
          </TourTarget>

          <View style={{ marginTop: spacing.xl }}>
            <Field label="Reason" value={reason} onChangeText={setReason} error={fieldErrors.reason} placeholder="Your manager sees this" multiline numberOfLines={3} style={{ minHeight: 76, textAlignVertical: "top" }} editable={!apply.isPending} />
          </View>

          <Button title="Submit request" onPress={submit} loading={apply.isPending} disabled={!canSubmit || preview.isPending} size="lg" />
        </ScrollView>
      </KeyboardAvoidingView>

      <DatePickerSheet
        open={picking !== null}
        value={picking === "from" ? fromDate : toDate}
        minimumDate={picking === "to" ? fromDate : undefined}
        title={picking === "from" ? "First day of leave" : "Last day of leave"}
        onClose={() => setPicking(null)}
        onSelect={(value) => {
          if (picking === "from") onFromChange(value);
          else setToDate(value);
          setPicking(null);
        }}
      />
    </SafeAreaView>
  );
}

function DateButton({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${dateLabel(value, "d MMMM yyyy")}`} style={{ flex: 1, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
      <Txt variant="caption" tone="subtle">
        {label}
      </Txt>
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
        <Ionicons name="calendar-outline" size={15} color={colors.brand[600]} />
        <Txt variant="bodyMedium" style={{ marginLeft: 6 }}>
          {dateLabel(value)}
        </Txt>
      </View>
    </Pressable>
  );
}
