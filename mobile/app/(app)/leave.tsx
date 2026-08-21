import { RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { format } from "date-fns";
import { useLeaveBalances, useLeaveRequests, type LeaveRequest } from "../../src/api/hooks";
import { useColors } from "../../src/theme/ThemeProvider";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Screen,
  SectionHeader,
  Txt,
} from "../../src/components/ui";
import { radius, spacing } from "../../src/theme";
import { ApiError } from "../../src/api/client";

/**
 * Leave: what you have, and what you have asked for.
 *
 * Balances first. Almost every visit to this screen starts with "how many days
 * do I have left", and putting the request history above it would bury the
 * answer under a list that is usually empty.
 */

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  approved: "success",
  pending: "warning",
  rejected: "danger",
  cancelled: "neutral",
};

export default function Leave() {
  const colors = useColors();
  const router = useRouter();
  const balances = useLeaveBalances();
  const requests = useLeaveRequests();

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
            Leave
          </Txt>
          <Button
            title="Apply"
            icon="add"
            size="sm"
            onPress={() => router.push("/(app)/apply-leave")}
          />
        </View>

        <SectionHeader title="Your balances" />
        {balances.isLoading ? (
          <Loading />
        ) : balances.isError ? (
          <ErrorState
            message={
              balances.error instanceof ApiError
                ? balances.error.message
                : "Could not load your balances."
            }
            onRetry={balances.refetch}
          />
        ) : (balances.data ?? []).length === 0 ? (
          <Card>
            <Txt variant="body" tone="muted">
              No leave types are assigned to you yet. Your HR team sets these up as part of your
              leave policy.
            </Txt>
          </Card>
        ) : (
          <View style={{ gap: spacing.md }}>
            {(balances.data ?? []).map((balance) => {
              const total = balance.allocated || 0;
              const used = balance.used || 0;
              const ratio = total > 0 ? Math.min(1, used / total) : 0;

              return (
                <Card key={balance.leaveTypeId}>
                  <View style={{ flexDirection: "row", alignItems: "baseline" }}>
                    <Txt variant="bodyMedium" style={{ flex: 1 }}>
                      {balance.leaveType?.name ?? balance.name ?? "Leave"}
                    </Txt>
                    <Txt variant="title" tone="brand">
                      {balance.available}
                    </Txt>
                    <Txt variant="caption" tone="muted" style={{ marginLeft: 4 }}>
                      left
                    </Txt>
                  </View>

                  {/* A bar makes "12 of 18" legible without doing arithmetic. */}
                  <View
                    style={{
                      height: 6,
                      backgroundColor: colors.surfaceSunken,
                      borderRadius: radius.full,
                      marginTop: spacing.md,
                      overflow: "hidden",
                    }}
                  >
                    <View
                      style={{
                        width: `${ratio * 100}%`,
                        height: "100%",
                        backgroundColor: colors.brand[500],
                        borderRadius: radius.full,
                      }}
                    />
                  </View>

                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                    <Txt variant="caption" tone="muted">
                      {used} used
                      {balance.pending ? ` · ${balance.pending} pending` : ""}
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
            <EmptyState
              icon="airplane-outline"
              title="No requests yet"
              body="When you apply for leave it will appear here, with its status."
              action={
                <Button title="Apply for leave" onPress={() => router.push("/(app)/apply-leave")} />
              }
            />
          </Card>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {(requests.data ?? []).map((request) => (
              <RequestRow key={request.id} request={request} />
            ))}
          </View>
        )}
      </Screen>
    </SafeAreaView>
  );
}

function RequestRow({ request }: { request: LeaveRequest }) {
  const colors = useColors();
  const sameDay = request.fromDate === request.toDate;

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="bodyMedium" numberOfLines={1}>
            {request.leaveTypeName ?? request.leaveType?.name ?? "Leave"}
          </Txt>
          <Txt variant="caption" tone="muted" style={{ marginTop: 3 }}>
            {sameDay
              ? format(new Date(request.fromDate), "d MMM yyyy")
              : `${format(new Date(request.fromDate), "d MMM")} – ${format(
                  new Date(request.toDate),
                  "d MMM yyyy"
                )}`}
            {" · "}
            {request.days} {request.days === 1 ? "day" : "days"}
          </Txt>
        </View>
        <Badge
          label={request.status.replace(/^./, (c) => c.toUpperCase())}
          tone={STATUS_TONE[request.status] ?? "neutral"}
        />
      </View>

      {/* A rejection without its reason is the most frustrating thing this
          screen can show, so it is never hidden behind a tap. */}
      {request.status === "rejected" && request.rejectionReason && (
        <View
          style={{
            marginTop: spacing.md,
            padding: spacing.md,
            backgroundColor: colors.dangerBg,
            borderRadius: radius.sm,
          }}
        >
          <Txt variant="caption" tone="danger" style={{ lineHeight: 18 }}>
            {request.rejectionReason}
          </Txt>
        </View>
      )}
    </Card>
  );
}
