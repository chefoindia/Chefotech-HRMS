import { useMemo, useState } from "react";
import { Modal, Pressable, RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { addMonths, format, getDaysInMonth, startOfMonth, getDay } from "date-fns";
import { useMonthAttendance, type AttendanceDay } from "../../src/api/hooks";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, ErrorState, Loading, Screen, Txt } from "../../src/components/ui";
import { radius, spacing } from "../../src/theme";
import { TourTarget } from "../../src/help/TourEngine";
import { ApiError } from "../../src/api/client";

/**
 * The attendance month.
 *
 * A calendar rather than a list, because the question people actually bring to
 * this screen is "which days went wrong", and a grid answers that at a glance
 * where thirty rows do not.
 *
 * Tapping a day opens the detail — including the breakdown of which rule
 * decided its status, which is the whole point of the engine and the thing
 * that stops an argument with HR before it starts.
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

function statusLabel(status?: string | null) {
  if (!status) return "—";
  return status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export default function Attendance() {
  const colors = useColors();
  const router = useRouter();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<AttendanceDay | null>(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;
  const query = useMonthAttendance(year, month);

  const byDate = useMemo(() => {
    const map = new Map<string, AttendanceDay>();
    for (const day of query.data?.days ?? []) map.set(day.date, day);
    return map;
  }, [query.data]);

  // Sunday-first grid; the leading blanks align the 1st under its weekday.
  const leading = getDay(cursor);
  const total = getDaysInMonth(cursor);
  const cells: (string | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: total }, (_, index) =>
      format(new Date(year, month - 1, index + 1), "yyyy-MM-dd")
    ),
  ];

  const isFuture = cursor >= startOfMonth(new Date());

  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const day of query.data?.days ?? []) {
      tally[day.status] = (tally[day.status] ?? 0) + 1;
    }
    return tally;
  }, [query.data]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={query.refetch}
            tintColor={colors.brand[600]}
          />
        }
      >
        <Txt variant="title" style={{ marginBottom: spacing.lg }}>
          Attendance
        </Txt>

        {/* Month switcher */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: spacing.md,
          }}
        >
          <Pressable
            onPress={() => setCursor(addMonths(cursor, -1))}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            style={{ padding: spacing.sm }}
          >
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </Pressable>

          <Txt variant="heading">{format(cursor, "MMMM yyyy")}</Txt>

          <Pressable
            onPress={() => !isFuture && setCursor(addMonths(cursor, 1))}
            hitSlop={12}
            disabled={isFuture}
            accessibilityRole="button"
            accessibilityLabel="Next month"
            style={{ padding: spacing.sm, opacity: isFuture ? 0.3 : 1 }}
          >
            <Ionicons name="chevron-forward" size={20} color={colors.text} />
          </Pressable>
        </View>

        {query.isLoading ? (
          <Loading label="Loading your month…" />
        ) : query.isError ? (
          <ErrorState
            message={
              query.error instanceof ApiError
                ? query.error.message
                : "Could not load your attendance."
            }
            onRetry={query.refetch}
          />
        ) : (
          <>
            <TourTarget id="attendance-calendar">
              <Card>
                <View style={{ flexDirection: "row", marginBottom: spacing.sm }}>
                  {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
                    <Txt
                      key={index}
                      variant="caption"
                      tone="subtle"
                      style={{ flex: 1, textAlign: "center" }}
                    >
                      {label}
                    </Txt>
                  ))}
                </View>

                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                  {cells.map((date, index) => {
                    if (!date) {
                      return <View key={`blank-${index}`} style={{ width: `${100 / 7}%`, height: 46 }} />;
                    }
                    const day = byDate.get(date);
                    const tone = day ? STATUS_TONE[day.status] ?? "neutral" : "neutral";
                    const fill = {
                      success: colors.successBg,
                      warning: colors.warningBg,
                      danger: colors.dangerBg,
                      info: colors.infoBg,
                      brand: colors.brand[50],
                      neutral: "transparent",
                    }[tone];
                    const ink = {
                      success: colors.success,
                      warning: colors.warning,
                      danger: colors.danger,
                      info: colors.info,
                      brand: colors.brand[700],
                      neutral: colors.textSubtle,
                    }[tone];

                    return (
                      <Pressable
                        key={date}
                        onPress={() => day && setSelected(day)}
                        disabled={!day}
                        accessibilityRole="button"
                        accessibilityLabel={`${format(new Date(date), "d MMMM")}, ${statusLabel(day?.status)}`}
                        style={{ width: `${100 / 7}%`, height: 46, padding: 3 }}
                      >
                        <View
                          style={{
                            flex: 1,
                            borderRadius: radius.sm,
                            backgroundColor: fill,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Txt variant="label" style={{ color: day ? ink : colors.textSubtle }}>
                            {Number(date.slice(-2))}
                          </Txt>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </Card>
            </TourTarget>

            <TourTarget id="attendance-summary">
              <Card style={{ marginTop: spacing.lg }}>
                <Txt variant="label" tone="muted" style={{ marginBottom: spacing.md }}>
                  This month
                </Txt>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                  {Object.entries(counts).map(([status, count]) => (
                    <Badge
                      key={status}
                      label={`${statusLabel(status)} · ${count}`}
                      tone={STATUS_TONE[status] ?? "neutral"}
                    />
                  ))}
                  {Object.keys(counts).length === 0 && (
                    <Txt variant="body" tone="muted">
                      Nothing recorded for this month yet.
                    </Txt>
                  )}
                </View>

                <Button
                  title="Request a correction"
                  variant="secondary"
                  icon="create-outline"
                  onPress={() => router.push("/(app)/correction")}
                  style={{ marginTop: spacing.lg }}
                />
              </Card>
            </TourTarget>
          </>
        )}
      </Screen>

      <DayDetail day={selected} onClose={() => setSelected(null)} />
    </SafeAreaView>
  );
}

function DayDetail({ day, onClose }: { day: AttendanceDay | null; onClose: () => void }) {
  const colors = useColors();
  const router = useRouter();
  if (!day) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" }}
        onPress={onClose}
      >
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            padding: spacing["2xl"],
            paddingBottom: spacing["4xl"],
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.lg }}>
            <View style={{ flex: 1 }}>
              <Txt variant="heading">{format(new Date(day.date), "EEEE, d MMMM")}</Txt>
              <View style={{ marginTop: 6 }}>
                <Badge label={statusLabel(day.status)} tone={STATUS_TONE[day.status] ?? "neutral"} />
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", marginBottom: spacing.lg }}>
            <Detail label="Check in" value={day.firstIn ? format(new Date(day.firstIn), "HH:mm") : "—"} />
            <Detail label="Check out" value={day.lastOut ? format(new Date(day.lastOut), "HH:mm") : "—"} />
            <Detail
              label="Worked"
              value={
                day.workedMinutes
                  ? `${Math.floor(day.workedMinutes / 60)}h ${day.workedMinutes % 60}m`
                  : "—"
              }
            />
          </View>

          {/* The explanation. This is what the whole engine exists to produce. */}
          {day.breakdown && day.breakdown.length > 0 && (
            <View
              style={{
                backgroundColor: colors.brand[50],
                borderRadius: radius.md,
                padding: spacing.lg,
                marginBottom: spacing.lg,
              }}
            >
              <Txt variant="label" style={{ color: colors.brand[900], marginBottom: 6 }}>
                How this day was decided
              </Txt>
              {day.breakdown.map((entry, index) => (
                <Txt
                  key={index}
                  variant="caption"
                  style={{ color: colors.brand[800], lineHeight: 18, marginTop: 2 }}
                >
                  {index + 1}. {entry.detail || entry.rule}
                </Txt>
              ))}
            </View>
          )}

          <Button
            title="Something looks wrong"
            variant="secondary"
            icon="create-outline"
            onPress={() => {
              onClose();
              router.push({ pathname: "/(app)/correction", params: { date: day.date } });
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
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
