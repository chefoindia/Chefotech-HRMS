import { useEffect, useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { format } from "date-fns";
import { useSession } from "../../src/auth/session";
import { useColors } from "../../src/theme/ThemeProvider";
import { useToday, useLeaveBalances, useHolidays, useUnreadCount } from "../../src/api/hooks";
import { useCheckIn } from "../../src/hooks/useCheckIn";
import { useToast } from "../../src/components/Toast";
import { Badge, Button, Card, Loading, Screen, SectionHeader, Txt } from "../../src/components/ui";
import { radius, spacing, shadow } from "../../src/theme";
import { useTheme } from "../../src/theme/ThemeProvider";
import { TourTarget } from "../../src/help/TourEngine";
import { fontStyle } from "../../src/theme/fonts";

/**
 * Home.
 *
 * Built around one question: am I checked in, and what do I do next? Anything
 * that does not help answer that is below the fold.
 */
export default function Home() {
  const { session } = useSession();
  const router = useRouter();
  const colors = useColors();
  const { colors: themeColors } = useTheme();
  const toast = useToast();

  const today = useToday();
  const balances = useLeaveBalances();
  const holidays = useHolidays();
  const unread = useUnreadCount();

  const checkIn = useCheckIn(today.data);
  const [now, setNow] = useState(new Date());

  // A live clock beside a check-in button is worth the render: it tells the
  // user the app is awake and that the time about to be recorded is this one.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const firstName = session?.user.firstName || "there";
  const greeting =
    now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";

  const status = today.data;
  const isCheckedIn = Boolean(status?.isCheckedIn);

  const onPunch = async () => {
    const result = await checkIn.submit();
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
  };

  const nextHoliday = (holidays.data ?? [])
    .filter((holiday) => holiday.date >= format(now, "yyyy-MM-dd"))
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  const totalLeave = (balances.data ?? []).reduce((sum, item) => sum + (item.available ?? 0), 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen
        refreshControl={
          <RefreshControl
            refreshing={today.isRefetching}
            onRefresh={() => {
              today.refetch();
              balances.refetch();
            }}
            tintColor={colors.brand[600]}
          />
        }
      >
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.xl }}>
          <View style={{ flex: 1 }}>
            <Txt variant="caption" tone="muted">
              {greeting}
            </Txt>
            <Txt variant="title" numberOfLines={1}>
              {firstName}
            </Txt>
          </View>
          <Pressable
            onPress={() => router.push("/(app)/notifications")}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            style={{ padding: spacing.sm }}
          >
            <Ionicons name="notifications-outline" size={23} color={colors.text} />
            {Boolean(unread.data) && (
              <View
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  minWidth: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: colors.danger,
                }}
              />
            )}
          </Pressable>
        </View>

        {/* The check-in card */}
        <TourTarget id="check-in-card">
          <Animated.View entering={FadeInDown.duration(360)}>
            <View
              style={[
                {
                  borderRadius: radius.xl,
                  padding: spacing.xl,
                  backgroundColor: isCheckedIn ? colors.success : colors.brand[600],
                },
                shadow(2, themeColors),
              ]}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View>
                  <Txt variant="caption" style={{ color: "rgba(255,255,255,0.8)" }}>
                    {format(now, "EEEE, d MMMM")}
                  </Txt>
                  <Txt
                    variant="display"
                    style={[{ color: colors.onBrand, marginTop: 2 }, (require("../../src/theme").type.tabular as object)]}
                  >
                    {format(now, "HH:mm")}
                  </Txt>
                </View>

                <View style={{ alignItems: "flex-end" }}>
                  <View
                    style={{
                      backgroundColor: "rgba(255,255,255,0.2)",
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: radius.full,
                    }}
                  >
                    <Txt variant="caption" style={[{ color: colors.onBrand }, fontStyle("600")]}>
                      {isCheckedIn ? "Checked in" : "Not checked in"}
                    </Txt>
                  </View>
                  {status?.shift?.name && (
                    <Txt variant="caption" style={{ color: "rgba(255,255,255,0.75)", marginTop: 6 }}>
                      {status.shift.name}
                      {status.shift.startTime ? ` · ${status.shift.startTime}–${status.shift.endTime}` : ""}
                    </Txt>
                  )}
                </View>
              </View>

              {/* Today so far */}
              {(status?.firstIn || status?.lastOut) && (
                <View
                  style={{
                    flexDirection: "row",
                    marginTop: spacing.lg,
                    paddingTop: spacing.md,
                    borderTopWidth: 1,
                    borderTopColor: "rgba(255,255,255,0.22)",
                  }}
                >
                  <TimeCell label="First in" value={status?.firstIn} />
                  <TimeCell label="Last out" value={status?.lastOut} />
                  <TimeCell
                    label="Worked"
                    value={
                      status?.workedMinutes
                        ? `${Math.floor(status.workedMinutes / 60)}h ${status.workedMinutes % 60}m`
                        : null
                    }
                    raw
                  />
                </View>
              )}

              <Button
                title={
                  checkIn.locating
                    ? "Getting your location…"
                    : isCheckedIn
                      ? "Check out"
                      : "Check in"
                }
                icon={isCheckedIn ? "log-out-outline" : "finger-print"}
                onPress={onPunch}
                loading={checkIn.busy}
                variant="secondary"
                size="lg"
                style={{ marginTop: spacing.xl, backgroundColor: colors.onBrand, borderWidth: 0 }}
              />
            </View>
          </Animated.View>
        </TourTarget>

        {/* Quick actions */}
        <SectionHeader title="Quick actions" />
        <TourTarget id="quick-actions">
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <QuickAction
              icon="airplane-outline"
              label="Apply leave"
              onPress={() => router.push("/(app)/apply-leave")}
            />
            <QuickAction
              icon="time-outline"
              label="Fix a day"
              onPress={() => router.push("/(app)/correction")}
            />
            <QuickAction
              icon="wallet-outline"
              label="Payslips"
              onPress={() => router.push("/(app)/payslips")}
            />
          </View>
        </TourTarget>

        {/* Leave balance */}
        <SectionHeader
          title="Leave balance"
          action={
            <Pressable onPress={() => router.push("/(app)/leave")} hitSlop={8}>
              <Txt variant="caption" tone="brand">
                See all
              </Txt>
            </Pressable>
          }
        />
        <Card>
          {balances.isLoading ? (
            <Loading />
          ) : (balances.data ?? []).length === 0 ? (
            <Txt variant="body" tone="muted">
              No leave types are assigned to you yet.
            </Txt>
          ) : (
            <>
              <View style={{ flexDirection: "row", alignItems: "baseline", marginBottom: spacing.md }}>
                <Txt variant="display" tone="brand">
                  {totalLeave % 1 === 0 ? totalLeave : totalLeave.toFixed(1)}
                </Txt>
                <Txt variant="body" tone="muted" style={{ marginLeft: 6 }}>
                  days available in total
                </Txt>
              </View>
              {(balances.data ?? []).slice(0, 3).map((balance) => (
                <View
                  key={balance.leaveTypeId}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    paddingVertical: 6,
                  }}
                >
                  <Txt variant="label" tone="muted">
                    {balance.leaveType?.name ?? balance.name ?? "Leave"}
                  </Txt>
                  <Txt variant="label">
                    {balance.available} of {balance.allocated}
                  </Txt>
                </View>
              ))}
            </>
          )}
        </Card>

        {/* Next holiday */}
        {nextHoliday && (
          <>
            <SectionHeader
              title="Coming up"
              action={
                <Pressable onPress={() => router.push("/(app)/holidays")} hitSlop={8}>
                  <Txt variant="caption" tone="brand">
                    All holidays
                  </Txt>
                </Pressable>
              }
            />
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: radius.md,
                    backgroundColor: colors.warningBg,
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: spacing.md,
                  }}
                >
                  <Ionicons name="sunny-outline" size={21} color={colors.warning} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyMedium">{nextHoliday.name}</Txt>
                  <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
                    {format(new Date(nextHoliday.date), "EEEE, d MMMM")}
                  </Txt>
                </View>
                {nextHoliday.isOptional && <Badge label="Optional" tone="info" />}
              </View>
            </Card>
          </>
        )}
      </Screen>
    </SafeAreaView>
  );
}

function TimeCell({ label, value, raw }: { label: string; value?: string | null; raw?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Txt variant="caption" style={{ color: "rgba(255,255,255,0.7)" }}>
        {label}
      </Txt>
      <Txt variant="bodyMedium" style={{ color: "#fff", marginTop: 2 }}>
        {value ? (raw ? value : format(new Date(value), "HH:mm")) : "—"}
      </Txt>
    </View>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flex: 1,
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        paddingVertical: spacing.lg,
        alignItems: "center",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={22} color={colors.brand[600]} />
      <Txt variant="caption" style={{ marginTop: 6, textAlign: "center" }}>
        {label}
      </Txt>
    </Pressable>
  );
}
