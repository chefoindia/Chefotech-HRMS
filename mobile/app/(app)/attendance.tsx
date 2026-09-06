import { useMemo, useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { addMonths, format, getDaysInMonth, startOfMonth, getDay } from "date-fns";
import { useMonthAttendance, type AttendanceRecord } from "../../src/api/hooks";
import { useSession } from "../../src/auth/session";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, ErrorState, Loading, Screen, Txt } from "../../src/components/ui";
import { Note, Sheet, Stat } from "../../src/components/Sheet";
import { radius, spacing } from "../../src/theme";
import { TourTarget } from "../../src/help/TourEngine";
import { ApiError } from "../../src/api/client";
import { dateLabel, humanise, minutesLabel, timeLabel } from "../../src/lib/format";

/**
 * The attendance month — the web portal's /me/attendance.
 *
 * A calendar rather than a list, because the question people bring to this
 * screen is "which days went wrong", and a grid answers that at a glance.
 * Tapping a day opens the detail: punches, the rules that decided it, and a
 * way to request a correction.
 */

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral" | "brand"> = {
  present: "success",
  half_day: "warning",
  absent: "danger",
  on_leave: "info",
  holiday: "brand",
  weekly_off: "neutral",
  pending: "warning",
};

export default function Attendance() {
  const colors = useColors();
  const router = useRouter();
  const { session } = useSession();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<AttendanceRecord | null>(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  const query = useMonthAttendance(year, month);
  const canCorrect = !session || session.permissions.includes("attendance.correct");
  const todayString = format(new Date(), "yyyy-MM-dd");

  const byDate = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const day of query.data?.days ?? []) map.set(day.date, day);
    return map;
  }, [query.data]);

  // Sunday-first grid; the leading blanks align the 1st under its weekday.
  const leading = getDay(cursor);
  const total = getDaysInMonth(cursor);
  const cells: (string | null)[] = [...Array.from({ length: leading }, () => null), ...Array.from({ length: total }, (_, index) => format(new Date(year, month - 1, index + 1), "yyyy-MM-dd"))];
  const isCurrentOrFuture = cursor >= startOfMonth(new Date());
  const summary = query.data?.summary;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={colors.brand[600]} />}>
        <Txt variant="title" style={{ marginBottom: spacing.lg }}>
          My attendance
        </Txt>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md }}>
          <Pressable onPress={() => setCursor(addMonths(cursor, -1))} hitSlop={12} accessibilityRole="button" accessibilityLabel="Previous month" style={{ padding: spacing.sm }}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </Pressable>
          <Txt variant="heading">{format(cursor, "MMMM yyyy")}</Txt>
          <Pressable onPress={() => !isCurrentOrFuture && setCursor(addMonths(cursor, 1))} hitSlop={12} disabled={isCurrentOrFuture} accessibilityRole="button" accessibilityLabel="Next month" style={{ padding: spacing.sm, opacity: isCurrentOrFuture ? 0.3 : 1 }}>
            <Ionicons name="chevron-forward" size={20} color={colors.text} />
          </Pressable>
        </View>

        {query.isLoading ? (
          <Loading label="Loading your month…" />
        ) : query.isError ? (
          <ErrorState message={query.error instanceof ApiError ? query.error.message : "Could not load your attendance."} onRetry={query.refetch} />
        ) : (
          <>
            {summary && (
              <TourTarget id="attendance-summary">
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg }}>
                  <Stat label="Present" value={summary.present} />
                  <Stat label="Half days" value={summary.halfDay} />
                  <Stat label="Absent" value={summary.absent} />
                  <Stat label="On leave" value={summary.leave} />
                  <Stat label="Late marks" value={summary.late} />
                  <Stat label="Missing punches" value={summary.missingPunch} />
                  <Stat label="Hours worked" value={summary.workedHours} />
                  <Stat label="Payable days" value={summary.payableDays} />
                </View>
              </TourTarget>
            )}

            <TourTarget id="attendance-calendar">
              <Card>
                <View style={{ flexDirection: "row", marginBottom: spacing.sm }}>
                  {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
                    <Txt key={index} variant="caption" tone="subtle" style={{ flex: 1, textAlign: "center" }}>
                      {label}
                    </Txt>
                  ))}
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                  {cells.map((date, index) => {
                    if (!date) return <View key={`blank-${index}`} style={{ width: `${100 / 7}%`, height: 50 }} />;
                    const day = byDate.get(date);
                    const future = date > todayString;
                    const tone = day && !future ? STATUS_TONE[day.status] ?? "neutral" : "neutral";
                    const fill = { success: colors.successBg, warning: colors.warningBg, danger: colors.dangerBg, info: colors.infoBg, brand: colors.brand[50], neutral: "transparent" }[tone];
                    const ink = { success: colors.success, warning: colors.warning, danger: colors.danger, info: colors.info, brand: colors.brand[700], neutral: colors.textSubtle }[tone];
                    return (
                      <Pressable key={date} onPress={() => day && !future && setSelected(day)} disabled={!day || future} accessibilityRole="button" accessibilityLabel={`${dateLabel(date, "d MMMM")}, ${day ? humanise(day.status) : "no record"}`} style={{ width: `${100 / 7}%`, height: 50, padding: 3 }}>
                        <View style={{ flex: 1, borderRadius: radius.sm, backgroundColor: fill, alignItems: "center", justifyContent: "center" }}>
                          <Txt variant="label" style={{ color: day && !future ? ink : colors.textSubtle }}>
                            {Number(date.slice(-2))}
                          </Txt>
                          {day && !future && (day.isLate || day.isMissingPunch) && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: colors.warning, marginTop: 2 }} />}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md }}>
                  {Object.entries(STATUS_TONE)
                    .filter(([key]) => key !== "pending")
                    .map(([key, tone]) => (
                      <Badge key={key} label={humanise(key)} tone={tone} />
                    ))}
                </View>
                <Txt variant="caption" tone="subtle" style={{ marginTop: spacing.sm }}>
                  Select any day to see how it was calculated. A dot marks a late mark or a missing punch.
                </Txt>
              </Card>
            </TourTarget>

            {canCorrect && <Button title="Request a correction" variant="secondary" icon="create-outline" onPress={() => router.push("/(app)/correction")} style={{ marginTop: spacing.lg }} />}
          </>
        )}
      </Screen>

      <DayDetail day={selected} canCorrect={canCorrect} onClose={() => setSelected(null)} />
    </SafeAreaView>
  );
}

function DayDetail({ day, canCorrect, onClose }: { day: AttendanceRecord | null; canCorrect: boolean; onClose: () => void }) {
  const colors = useColors();
  const router = useRouter();
  if (!day) return null;

  return (
    <Sheet open onClose={onClose} title={dateLabel(day.date, "EEEE, d MMMM")} subtitle="How this day was calculated.">
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg }}>
        <Badge label={humanise(day.status)} tone={STATUS_TONE[day.status] ?? "neutral"} />
        <Txt variant="caption" tone="muted">
          {day.payableDays} payable {day.payableDays === 1 ? "day" : "days"}
        </Txt>
        {day.isLocked && <Badge label="Locked for payroll" tone="neutral" />}
        {day.holidayName && <Badge label={day.holidayName} tone="brand" />}
        {day.leaveType && <Badge label={day.leaveType} tone="info" />}
      </View>

      <View style={{ flexDirection: "row", marginBottom: spacing.lg }}>
        <Detail label="Check in" value={timeLabel(day.firstPunchAt)} />
        <Detail label="Check out" value={timeLabel(day.lastPunchAt)} />
        <Detail label="Worked" value={minutesLabel(day.effectiveMinutes)} />
      </View>
      {(day.isLate || day.isMissingPunch || day.isEarlyLeaving) && (
        <Txt variant="caption" tone="warning" style={{ marginBottom: spacing.md }}>
          {[day.isLate ? `Late by ${day.lateByMinutes} minutes` : null, day.isEarlyLeaving ? `Left early by ${day.earlyLeavingByMinutes} minutes` : null, day.isMissingPunch ? "Missing punch" : null].filter(Boolean).join(" · ")}
        </Txt>
      )}

      {day.punches && day.punches.length > 0 && (
        <View style={{ marginBottom: spacing.lg }}>
          <Txt variant="caption" tone="subtle" style={{ textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
            Punches
          </Txt>
          {day.punches.map((punch, index) => (
            <Txt key={index} variant="caption" tone="muted" style={{ lineHeight: 18 }}>
              {timeLabel(punch.at)} · {punch.direction ? humanise(punch.direction) : "—"} · {humanise(punch.source)}
              {punch.isManual ? " · added manually" : ""}
            </Txt>
          ))}
        </View>
      )}

      <View style={{ backgroundColor: colors.brand[50], borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg }}>
        <Txt variant="label" style={{ color: colors.brand[900], marginBottom: 6 }}>
          Rules applied
        </Txt>
        {!day.breakdown?.length ? (
          <Txt variant="caption" style={{ color: colors.brand[800] }}>
            No calculation trail for this day.
          </Txt>
        ) : (
          day.breakdown.map((entry, index) => (
            <View key={index} style={{ flexDirection: "row", gap: spacing.sm, marginTop: 2 }}>
              <Txt variant="caption" style={{ color: colors.brand[800], lineHeight: 18, flex: 1 }}>
                {entry.detail || entry.rule}
              </Txt>
              <Txt variant="caption" style={{ color: colors.brand[900], lineHeight: 18 }}>
                {entry.effect}
              </Txt>
            </View>
          ))
        )}
      </View>

      {day.isManualOverride && <Note tone="info">This day was set manually by HR, so the punch rules were not applied.</Note>}

      {canCorrect && !day.isLocked && (
        <Button
          title="Request a correction"
          variant="secondary"
          icon="create-outline"
          onPress={() => {
            onClose();
            router.push({ pathname: "/(app)/correction", params: { date: day.date, missing: day.isMissingPunch ? "1" : "0" } });
          }}
          style={{ marginBottom: spacing.lg }}
        />
      )}
    </Sheet>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Txt variant="caption" tone="subtle">
        {label}
      </Txt>
      <Txt variant="bodyMedium" style={{ marginTop: 2 }}>
        {value}
      </Txt>
    </View>
  );
}
