import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { format, parseISO } from "date-fns";
import { useRequestCorrection } from "../../src/api/hooks";
import { useColors } from "../../src/theme/ThemeProvider";
import { Button, Card, Field, Txt } from "../../src/components/ui";
import { radius, spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";
import { ApiError } from "../../src/api/client";
import { DatePickerSheet } from "../../src/components/DatePickerSheet";

/**
 * Requesting an attendance correction.
 *
 * The times are optional. The most common case by far is "I was here, I forgot
 * to check out" — where the employee knows the day was wrong but not the exact
 * minute, and forcing them to invent one produces a worse record than leaving
 * it for the approver to set.
 */
export default function Correction() {
  const colors = useColors();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ date?: string }>();
  const request = useRequestCorrection();

  const [date, setDate] = useState<string>(
    params.date ?? format(new Date(), "yyyy-MM-dd")
  );
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [reason, setReason] = useState("");
  const [picking, setPicking] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validTime = (value: string) => !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

  const submit = async () => {
    const errors: Record<string, string> = {};
    if (reason.trim().length < 5) errors.reason = "Explain what happened — your approver reads this.";
    if (!validTime(checkIn)) errors.checkIn = "Use 24-hour time, like 09:15.";
    if (!validTime(checkOut)) errors.checkOut = "Use 24-hour time, like 18:30.";

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      await request.mutateAsync({
        date,
        checkIn: checkIn || undefined,
        checkOut: checkOut || undefined,
        reason: reason.trim(),
      });
      toast.success("Correction requested. Your approver will review it.");
      router.back();
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors);
        toast.error(error.message);
      } else {
        toast.error("Could not submit that request.");
      }
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", padding: spacing.lg }}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Txt variant="heading" style={{ marginLeft: spacing.sm }}>
          Request a correction
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
        >
          <Card style={{ marginBottom: spacing.lg }}>
            <Txt variant="body" tone="muted" style={{ lineHeight: 21 }}>
              Tell your approver what actually happened on this day. Once they approve it, the day
              is recalculated automatically — you do not need to do anything else.
            </Txt>
          </Card>

          <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>
            Which day
          </Txt>
          <Pressable
            onPress={() => setPicking(true)}
            accessibilityRole="button"
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: spacing.lg,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              marginBottom: spacing.lg,
            }}
          >
            <Ionicons name="calendar-outline" size={18} color={colors.brand[600]} />
            <Txt variant="bodyMedium" style={{ flex: 1, marginLeft: spacing.md }}>
              {format(parseISO(date), "EEEE, d MMMM yyyy")}
            </Txt>
            <Ionicons name="chevron-forward" size={17} color={colors.textSubtle} />
          </Pressable>

          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Field
                label="Check in (optional)"
                value={checkIn}
                onChangeText={setCheckIn}
                error={fieldErrors.checkIn}
                placeholder="09:00"
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                editable={!request.isPending}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Check out (optional)"
                value={checkOut}
                onChangeText={setCheckOut}
                error={fieldErrors.checkOut}
                placeholder="18:00"
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                editable={!request.isPending}
              />
            </View>
          </View>

          <Field
            label="What happened"
            value={reason}
            onChangeText={setReason}
            error={fieldErrors.reason}
            hint="Leave the times blank if you are not sure — your approver can set them."
            placeholder="e.g. I was on site all day but forgot to check out."
            multiline
            numberOfLines={4}
            style={{ minHeight: 92, textAlignVertical: "top" }}
            editable={!request.isPending}
          />

          <Button
            title="Submit request"
            onPress={submit}
            loading={request.isPending}
            size="lg"
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <DatePickerSheet
        open={picking}
        value={date}
        title="Which day needs correcting?"
        onClose={() => setPicking(false)}
        onSelect={(value) => {
          setDate(value);
          setPicking(false);
        }}
      />
    </SafeAreaView>
  );
}
