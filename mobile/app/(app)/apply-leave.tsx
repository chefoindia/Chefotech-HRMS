import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { addDays, format, isBefore, parseISO } from "date-fns";
import {
  useApplyLeave,
  useLeaveBalances,
  useLeavePreview,
  type LeavePreview,
} from "../../src/api/hooks";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, Field, Loading, Txt } from "../../src/components/ui";
import { radius, spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";
import { ApiError } from "../../src/api/client";
import { TourTarget } from "../../src/help/TourEngine";
import { DatePickerSheet } from "../../src/components/DatePickerSheet";

/**
 * Applying for leave.
 *
 * The reason this screen exists in the shape it does is the preview. Leave
 * arithmetic is the single most common source of disputes with HR, because the
 * rule that decides whether the weekend inside your request is deducted is
 * invisible until the balance moves.
 *
 * So the cost is fetched from the server — the same engine that will do the
 * real deduction, not a guess reimplemented on the phone — and shown day by
 * day with the rule that produced it, before the submit button is even
 * enabled.
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
  const [reason, setReason] = useState("");
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [result, setResult] = useState<LeavePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const selected = useMemo(
    () => (balances.data ?? []).find((balance) => balance.leaveTypeId === leaveTypeId),
    [balances.data, leaveTypeId]
  );

  // Default to whichever type they actually have days in, so the common case
  // needs no selection at all.
  useEffect(() => {
    if (!leaveTypeId && balances.data?.length) {
      const withDays = balances.data.find((balance) => (balance.available ?? 0) > 0);
      setLeaveTypeId((withDays ?? balances.data[0]).leaveTypeId);
    }
  }, [balances.data, leaveTypeId]);

  // Keep the range coherent: moving the start past the end drags the end with
  // it, rather than leaving an invalid range the server will reject.
  const onFromChange = (value: string) => {
    setFromDate(value);
    if (isBefore(parseISO(toDate), parseISO(value))) setToDate(value);
  };

  const runPreview = useCallback(async () => {
    if (!leaveTypeId || !fromDate || !toDate) return;
    setPreviewError(null);
    try {
      const response = await preview.mutateAsync({ leaveTypeId, fromDate, toDate });
      setResult(response.data);
    } catch (error) {
      setResult(null);
      setPreviewError(
        error instanceof ApiError ? error.message : "Could not work out the cost of these dates."
      );
    }
    // `preview` is a stable mutation object from React Query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaveTypeId, fromDate, toDate]);

  // Recompute whenever the inputs settle. Debounced because the date sheet can
  // fire several changes as the user scrubs through a month.
  useEffect(() => {
    const timer = setTimeout(runPreview, 250);
    return () => clearTimeout(timer);
  }, [runPreview]);

  const submit = async () => {
    setFieldErrors({});
    if (!leaveTypeId) {
      setFieldErrors({ leaveTypeId: "Choose a leave type." });
      return;
    }
    if (reason.trim().length < 3) {
      setFieldErrors({ reason: "Give a short reason — your approver will see it." });
      return;
    }

    try {
      await apply.mutateAsync({ leaveTypeId, fromDate, toDate, reason: reason.trim() });
      toast.success("Leave request submitted.");
      router.replace("/(app)/leave");
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors);
        toast.error(error.message);
      } else {
        toast.error("Could not submit that request.");
      }
    }
  };

  const exceedsBalance =
    result && selected && typeof selected.available === "number"
      ? result.days > selected.available
      : false;

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

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={80}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["4xl"] }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Type */}
          <TourTarget id="leave-type">
            <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>
              Leave type
            </Txt>
            {balances.isLoading ? (
              <Loading />
            ) : (
              <View style={{ gap: spacing.sm }}>
                {(balances.data ?? []).map((balance) => {
                  const active = balance.leaveTypeId === leaveTypeId;
                  return (
                    <Pressable
                      key={balance.leaveTypeId}
                      onPress={() => setLeaveTypeId(balance.leaveTypeId)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        padding: spacing.lg,
                        borderRadius: radius.md,
                        borderWidth: active ? 2 : 1,
                        borderColor: active ? colors.brand[600] : colors.border,
                        backgroundColor: active ? colors.brand[50] : colors.surface,
                      }}
                    >
                      <Ionicons
                        name={active ? "radio-button-on" : "radio-button-off"}
                        size={19}
                        color={active ? colors.brand[600] : colors.textSubtle}
                      />
                      <Txt variant="bodyMedium" style={{ flex: 1, marginLeft: spacing.md }}>
                        {balance.leaveType?.name ?? balance.name ?? "Leave"}
                      </Txt>
                      <Badge
                        label={`${balance.available} left`}
                        tone={balance.available > 0 ? "success" : "danger"}
                      />
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

          {/* Dates */}
          <TourTarget id="leave-dates">
            <Txt variant="label" tone="muted" style={{ marginTop: spacing.xl, marginBottom: 6 }}>
              Dates
            </Txt>
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <DateButton label="From" value={fromDate} onPress={() => setPicking("from")} />
              <DateButton label="To" value={toDate} onPress={() => setPicking("to")} />
            </View>
          </TourTarget>

          {/* The preview */}
          <TourTarget id="leave-preview">
            <View style={{ marginTop: spacing.xl }}>
              {preview.isPending ? (
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
                <Card
                  style={{
                    backgroundColor: exceedsBalance ? colors.dangerBg : colors.warningBg,
                    borderColor: exceedsBalance ? colors.danger : colors.warning,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "baseline" }}>
                    <Txt variant="bodyMedium" style={{ flex: 1 }}>
                      This request costs
                    </Txt>
                    <Txt
                      variant="title"
                      tone={exceedsBalance ? "danger" : "warning"}
                    >
                      {result.days} {result.days === 1 ? "day" : "days"}
                    </Txt>
                  </View>

                  {/* Day by day, with the rule that produced each line. */}
                  {result.breakdown?.length > 0 && (
                    <View style={{ marginTop: spacing.md, gap: 3 }}>
                      {result.breakdown.map((entry) => (
                        <View
                          key={entry.date}
                          style={{ flexDirection: "row", alignItems: "flex-start" }}
                        >
                          <Ionicons
                            name={entry.deducted ? "remove-circle" : "ellipse-outline"}
                            size={13}
                            color={entry.deducted ? colors.warning : colors.textSubtle}
                            style={{ marginTop: 3 }}
                          />
                          <Txt
                            variant="caption"
                            tone="muted"
                            style={{ flex: 1, marginLeft: 6, lineHeight: 18 }}
                          >
                            {format(parseISO(entry.date), "EEE d MMM")} — {entry.reason}
                          </Txt>
                        </View>
                      ))}
                    </View>
                  )}

                  {typeof result.balanceAfter === "number" && (
                    <Txt variant="caption" tone="subtle" style={{ marginTop: spacing.md }}>
                      Balance after approval: {result.balanceAfter} days
                    </Txt>
                  )}

                  {exceedsBalance && (
                    <Txt variant="caption" tone="danger" style={{ marginTop: spacing.sm, lineHeight: 18 }}>
                      This is more than you have available. Your employer may still allow it — the
                      approver will see the shortfall.
                    </Txt>
                  )}

                  {result.warnings?.map((warning) => (
                    <Txt
                      key={warning}
                      variant="caption"
                      tone="warning"
                      style={{ marginTop: spacing.sm, lineHeight: 18 }}
                    >
                      {warning}
                    </Txt>
                  ))}
                </Card>
              ) : null}
            </View>
          </TourTarget>

          {/* Reason */}
          <View style={{ marginTop: spacing.xl }}>
            <Field
              label="Reason"
              value={reason}
              onChangeText={setReason}
              error={fieldErrors.reason}
              placeholder="A short note for your approver"
              multiline
              numberOfLines={3}
              style={{ minHeight: 76, textAlignVertical: "top" }}
              editable={!apply.isPending}
            />
          </View>

          <Button
            title="Submit request"
            onPress={submit}
            loading={apply.isPending}
            disabled={!result || preview.isPending}
            size="lg"
          />
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

function DateButton({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${format(parseISO(value), "d MMMM yyyy")}`}
      style={{
        flex: 1,
        padding: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <Txt variant="caption" tone="subtle">
        {label}
      </Txt>
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
        <Ionicons name="calendar-outline" size={15} color={colors.brand[600]} />
        <Txt variant="bodyMedium" style={{ marginLeft: 6 }}>
          {format(parseISO(value), "d MMM yyyy")}
        </Txt>
      </View>
    </Pressable>
  );
}
