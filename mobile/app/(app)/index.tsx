import { useEffect, useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { format } from "date-fns";
import { useSession } from "../../src/auth/session";
import { useColors, useTheme } from "../../src/theme/ThemeProvider";
import { useDashboard, useToday, useUnreadCount, leaveTypeOf } from "../../src/api/hooks";
import { useCheckIn } from "../../src/hooks/useCheckIn";
import { useToast } from "../../src/components/Toast";
import { Badge, Button, Card, EmptyState, Loading, Screen, SectionHeader, Txt } from "../../src/components/ui";
import { Note, Stat } from "../../src/components/Sheet";
import { radius, spacing, shadow, type } from "../../src/theme";
import { TourTarget } from "../../src/help/TourEngine";
import { fontStyle } from "../../src/theme/fonts";
import { dateLabel, humanise, minutesLabel, timeLabel } from "../../src/lib/format";

/**
 * Home — the same page as the web portal's /me: today's check-in, this
 * month in numbers, leave balances, requests waiting, upcoming holidays,
 * and the four things people open most.
 */
export default function Home() {
  const { session } = useSession();
  const router = useRouter();
  const colors = useColors();
  const { colors: themeColors } = useTheme();
  const toast = useToast();

  const today = useToday();
  const dashboard = useDashboard();
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
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";
  const status = today.data;
  const isCheckedIn = Boolean(status?.isCheckedIn);
  const data = dashboard.data;
  const canPunch = !session || session.permissions.includes("attendance.punch");

  const onPunch = async () => {
    const result = await checkIn.submit();
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
  };

  const refresh = () => {
    today.refetch();
    dashboard.refetch();
    unread.refetch();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={today.isRefetching || dashboard.isRefetching} onRefresh={refresh} tintColor={colors.brand[600]} />}>
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
          <Pressable onPress={() => router.push("/(app)/notifications")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Notifications" style={{ padding: spacing.sm }}>
            <Ionicons name="notifications-outline" size={23} color={colors.text} />
            {Boolean(unread.data) && <View style={{ position: "absolute", top: 4, right: 4, minWidth: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger }} />}
          </Pressable>
        </View>

        {session?.passwordExpired && (
          <Pressable onPress={() => router.push("/(app)/security")}>
            <Note tone="warning">Your password is due for a change. Tap to choose a new one.</Note>
          </Pressable>
        )}
        {session?.mfaSetupRequired && !session?.mfaEnabled && (
          <Pressable onPress={() => router.push("/(app)/security")}>
            <Note tone="warning">Your organization requires two-factor authentication for your account. Tap to set it up.</Note>
          </Pressable>
        )}

        {dashboard.data && !dashboard.data.hasEmployeeRecord ? (
          <Card>
            <EmptyState icon="person-circle-outline" title="Your account is not linked to an employee record" body="Ask your HR team to connect your login to your employee profile so you can see attendance, leave and payslips." />
          </Card>
        ) : (
          <>
            {/* The check-in card */}
            {canPunch && (
              <TourTarget id="check-in-card">
                <Animated.View entering={FadeInDown.duration(360)}>
                  <View style={[{ borderRadius: radius.xl, padding: spacing.xl, backgroundColor: isCheckedIn ? colors.success : colors.brand[600] }, shadow(2, themeColors)]}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <View>
                        <Txt variant="caption" style={{ color: "rgba(255,255,255,0.8)" }}>
                          {format(now, "EEEE, d MMMM")}
                        </Txt>
                        <Txt variant="display" style={[{ color: colors.onBrand, marginTop: 2 }, type.tabular as object]}>
                          {format(now, "HH:mm")}
                        </Txt>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <View style={{ backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full }}>
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

                    {(status?.firstIn || status?.lastOut) && (
                      <View style={{ flexDirection: "row", marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.22)" }}>
                        <TimeCell label="First in" value={timeLabel(status?.firstIn)} />
                        <TimeCell label="Last out" value={timeLabel(status?.lastOut)} />
                        <TimeCell label="Worked" value={minutesLabel(status?.workedMinutes)} />
                      </View>
                    )}
                    {data?.today?.isLate && (
                      <Txt variant="caption" style={{ color: "rgba(255,255,255,0.85)", marginTop: spacing.sm }}>
                        Marked late by {data.today.lateByMinutes} minutes
                      </Txt>
                    )}

                    <Button
                      title={checkIn.locating ? "Getting your location…" : isCheckedIn ? "Check out" : "Check in"}
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
            )}

            {/* This month */}
            <SectionHeader title="This month" />
            {dashboard.isLoading ? (
              <Loading />
            ) : data ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                <Stat label="Present" value={data.monthSummary.present} hint={`${data.monthSummary.payableDays} payable days`} />
                <Stat label="Hours worked" value={data.monthSummary.workedHours} hint={data.monthSummary.overtimeHours ? `${data.monthSummary.overtimeHours} overtime` : undefined} />
                <Stat label="Late marks" value={data.monthSummary.late} hint={data.monthSummary.missingPunch ? `${data.monthSummary.missingPunch} missing punches` : undefined} />
                <Stat label="Leave taken" value={data.monthSummary.leave} hint={`${data.monthSummary.absent} absent`} />
              </View>
            ) : null}

            {/* Quick actions */}
            <SectionHeader title="Quick actions" />
            <TourTarget id="quick-actions">
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <QuickAction icon="calendar-outline" label="Attendance" onPress={() => router.push("/(app)/attendance")} />
                <QuickAction icon="airplane-outline" label="Apply leave" onPress={() => router.push("/(app)/apply-leave")} />
                <QuickAction icon="wallet-outline" label="Payslips" onPress={() => router.push("/(app)/payslips")} />
                <QuickAction icon="folder-outline" label="Documents" onPress={() => router.push("/(app)/documents")} />
              </View>
            </TourTarget>

            {/* Leave balance */}
            <SectionHeader
              title="Leave balance"
              action={
                <Pressable onPress={() => router.push("/(app)/apply-leave")} hitSlop={8}>
                  <Txt variant="caption" tone="brand">
                    Apply for leave
                  </Txt>
                </Pressable>
              }
            />
            <Card>
              {dashboard.isLoading ? (
                <Loading />
              ) : !data?.leaveBalances.length ? (
                <Txt variant="body" tone="muted">
                  No leave types are available to you yet.
                </Txt>
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                  {data.leaveBalances.map((balance) => (
                    <View key={balance.leaveType.id} style={{ flex: 1, minWidth: "45%", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: balance.leaveType.colour || colors.brand[500] }} />
                        <Txt variant="label" numberOfLines={1} style={{ flex: 1 }}>
                          {balance.leaveType.name}
                        </Txt>
                      </View>
                      <Txt variant="title" style={{ marginTop: 4 }}>
                        {balance.available ?? 0}
                      </Txt>
                      <Txt variant="caption" tone="muted">
                        days left{balance.pending ? ` · ${balance.pending} pending` : ""}
                      </Txt>
                    </View>
                  ))}
                </View>
              )}
            </Card>

            {/* Your requests */}
            <SectionHeader
              title="Your requests"
              action={
                <Pressable onPress={() => router.push("/(app)/leave")} hitSlop={8}>
                  <Txt variant="caption" tone="brand">
                    See all
                  </Txt>
                </Pressable>
              }
            />
            <Card>
              {!data?.pendingLeave.length ? (
                <Txt variant="body" tone="muted">
                  Nothing waiting for approval.
                </Txt>
              ) : (
                data.pendingLeave.map((request, index) => {
                  const leaveType = leaveTypeOf(request);
                  return (
                    <View key={request.id} style={{ flexDirection: "row", alignItems: "center", paddingTop: index ? spacing.sm : 0, marginTop: index ? spacing.sm : 0, borderTopWidth: index ? 1 : 0, borderTopColor: colors.border }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: leaveType?.colour || colors.borderStrong, marginRight: spacing.sm }} />
                      <View style={{ flex: 1 }}>
                        <Txt variant="label" numberOfLines={1}>
                          {leaveType?.name || "Leave"} · {request.leaveDays} day{request.leaveDays === 1 ? "" : "s"}
                        </Txt>
                        <Txt variant="caption" tone="muted">
                          {dateLabel(request.fromDate)}
                          {request.fromDate !== request.toDate ? ` → ${dateLabel(request.toDate)}` : ""}
                        </Txt>
                      </View>
                      <Badge label={humanise(request.status)} tone="warning" />
                    </View>
                  );
                })
              )}
            </Card>

            {/* Upcoming holidays */}
            <SectionHeader
              title="Upcoming holidays"
              action={
                <Pressable onPress={() => router.push("/(app)/holidays")} hitSlop={8}>
                  <Txt variant="caption" tone="brand">
                    All holidays
                  </Txt>
                </Pressable>
              }
            />
            <Card>
              {!data?.upcomingHolidays.length ? (
                <Txt variant="body" tone="muted">
                  No holidays coming up.
                </Txt>
              ) : (
                data.upcomingHolidays.map((holiday, index) => (
                  <View key={holiday._id} style={{ flexDirection: "row", alignItems: "center", paddingTop: index ? spacing.sm : 0, marginTop: index ? spacing.sm : 0, borderTopWidth: index ? 1 : 0, borderTopColor: colors.border }}>
                    <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.warningBg, alignItems: "center", justifyContent: "center", marginRight: spacing.md }}>
                      <Ionicons name="sunny-outline" size={18} color={colors.warning} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyMedium" numberOfLines={1}>
                        {holiday.name}
                      </Txt>
                      <Txt variant="caption" tone="muted">
                        {dateLabel(holiday.date, "EEEE, d MMMM")}
                      </Txt>
                    </View>
                  </View>
                ))
              )}
            </Card>
          </>
        )}
      </Screen>
    </SafeAreaView>
  );
}

function TimeCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Txt variant="caption" style={{ color: "rgba(255,255,255,0.7)" }}>
        {label}
      </Txt>
      <Txt variant="bodyMedium" style={{ color: "#fff", marginTop: 2 }}>
        {value}
      </Txt>
    </View>
  );
}

function QuickAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, alignItems: "center", opacity: pressed ? 0.7 : 1 })}>
      <Ionicons name={icon} size={21} color={colors.brand[600]} />
      <Txt variant="caption" style={{ marginTop: 6, textAlign: "center" }} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );
}
