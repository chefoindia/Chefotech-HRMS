import { Alert, RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { leaveTypeOf, useCancelLeave, useLeaveBalances, useLeaveRequests, type LeaveRequest } from "../../src/api/hooks";
import { ApiError } from "../../src/api/client";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, EmptyState, ErrorState, Loading, Screen, SectionHeader, Txt } from "../../src/components/ui";
import { radius, spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";
import { dateLabel, humanise } from "../../src/lib/format";

/**
 * Leave: what you have, what you have asked for, and how many days each
 * request actually cost — the same page as the web portal's /me/leave.
 */

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { approved: "success", pending: "warning", rejected: "danger", cancelled: "neutral", withdrawn: "neutral", draft: "neutral" };

export default function Leave() {
  const colors = useColors();
  const router = useRouter();
  const toast = useToast();
  const balances = useLeaveBalances();
  const requests = useLeaveRequests();
  const cancel = useCancelLeave();

  const eligible = (balances.data ?? []).filter((b) => b.eligible && b.hasBalance);

  const confirmCancel = (request: LeaveRequest) =>
    Alert.alert("Cancel this leave request?", `${request.leaveDays} day${request.leaveDays === 1 ? "" : "s"} from ${dateLabel(request.fromDate)} will be returned to your balance.`, [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel leave",
        style: "destructive",
        onPress: () =>
          cancel
            .mutateAsync(request.id)
            .then(() => toast.success("Leave cancelled. The days are back in your balance."))
            .catch((error) => toast.error(error instanceof ApiError ? error.message : "Could not cancel that request.")),
      },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen
        refreshControl={
          <RefreshControl
            refreshing={balances.isRefetching || requests.isRefetching}
            onRefresh={() => {
              balances.refetch();
              requests.refetch();
            }}
            tintColor={colors.brand[600]}
          />
        }
      >
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.lg }}>
          <Txt variant="title" style={{ flex: 1 }}>
            My leave
          </Txt>
          <Button title="Apply" icon="add" size="sm" onPress={() => router.push("/(app)/apply-leave")} />
        </View>

        <SectionHeader title="Your balances" />
        {balances.isLoading ? (
          <Loading />
        ) : balances.isError ? (
          <ErrorState message={balances.error instanceof ApiError ? balances.error.message : "Could not load your balances."} onRetry={balances.refetch} />
        ) : eligible.length === 0 ? (
          <Card>
            <EmptyState icon="airplane-outline" title="No leave types available" body="Ask HR to assign a leave policy to your profile." />
          </Card>
        ) : (
          <View style={{ gap: spacing.md }}>
            {eligible.map((balance) => {
              const total = balance.allocated || 0;
              const used = balance.used || 0;
              const ratio = total > 0 ? Math.min(1, used / total) : 0;
              return (
                <Card key={balance.leaveType.id}>
                  <View style={{ flexDirection: "row", alignItems: "baseline" }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: balance.leaveType.colour || colors.brand[500], marginRight: spacing.sm }} />
                    <Txt variant="bodyMedium" style={{ flex: 1 }}>
                      {balance.leaveType.name}
                    </Txt>
                    <Txt variant="title" tone="brand">
                      {balance.available ?? 0}
                    </Txt>
                    <Txt variant="caption" tone="muted" style={{ marginLeft: 4 }}>
                      available
                    </Txt>
                  </View>
                  <View style={{ height: 6, backgroundColor: colors.surfaceSunken, borderRadius: radius.full, marginTop: spacing.md, overflow: "hidden" }}>
                    <View style={{ width: `${ratio * 100}%`, height: "100%", backgroundColor: colors.brand[500], borderRadius: radius.full }} />
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                    <Txt variant="caption" tone="muted">
                      {used} used{balance.pending ? ` · ${balance.pending} pending` : ""}
                    </Txt>
                    <Txt variant="caption" tone="subtle">
                      {total} allocated
                    </Txt>
                  </View>
                </Card>
              );
            })}
          </View>
        )}

        <SectionHeader title="Your requests" />
        {requests.isLoading ? (
          <Loading />
        ) : (requests.data ?? []).length === 0 ? (
          <Card>
            <EmptyState icon="airplane-outline" title="You have not applied for leave yet" body="When you do, you will see the status here." action={<Button title="Apply for leave" onPress={() => router.push("/(app)/apply-leave")} />} />
          </Card>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {(requests.data ?? []).map((request) => (
              <RequestRow key={request.id} request={request} onCancel={() => confirmCancel(request)} cancelling={cancel.isPending && cancel.variables === request.id} />
            ))}
          </View>
        )}
      </Screen>
    </SafeAreaView>
  );
}

function RequestRow({ request, onCancel, cancelling }: { request: LeaveRequest; onCancel: () => void; cancelling: boolean }) {
  const colors = useColors();
  const leaveType = leaveTypeOf(request);
  const sameDay = request.fromDate === request.toDate;
  const canCancel = ["pending", "approved"].includes(request.status);

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: leaveType?.colour || colors.borderStrong, marginTop: 6, marginRight: spacing.sm }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="bodyMedium" numberOfLines={1}>
            {leaveType?.name ?? "Leave"} · {request.leaveDays} {request.leaveDays === 1 ? "day" : "days"}
          </Txt>
          <Txt variant="caption" tone="muted" style={{ marginTop: 3 }}>
            {sameDay ? dateLabel(request.fromDate) : `${dateLabel(request.fromDate, "d MMM")} → ${dateLabel(request.toDate)}`}
            {request.reason ? ` · ${request.reason}` : ""}
          </Txt>
        </View>
        <Badge label={humanise(request.status)} tone={STATUS_TONE[request.status] ?? "neutral"} />
      </View>

      {request.status === "rejected" && request.rejectionReason ? (
        <View style={{ marginTop: spacing.md, padding: spacing.md, backgroundColor: colors.dangerBg, borderRadius: radius.sm }}>
          <Txt variant="caption" tone="danger" style={{ lineHeight: 18 }}>
            Reason: {request.rejectionReason}
          </Txt>
        </View>
      ) : null}

      {canCancel && (
        <View style={{ marginTop: spacing.sm, alignSelf: "flex-start" }}>
          <Button title="Cancel" variant="ghost" size="sm" icon="close-outline" onPress={onCancel} loading={cancelling} />
        </View>
      )}
    </Card>
  );
}
