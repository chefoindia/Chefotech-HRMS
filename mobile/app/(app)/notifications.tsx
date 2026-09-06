import { Pressable, RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { formatDistanceToNow } from "date-fns";
import { useMarkNotificationRead, useNotifications } from "../../src/api/hooks";
import { routeForActionUrl } from "../../src/notifications/deepLink";
import { useColors } from "../../src/theme/ThemeProvider";
import { Card, EmptyState, ErrorState, Loading, Screen, Txt } from "../../src/components/ui";
import { radius, spacing } from "../../src/theme";
import { ApiError } from "../../src/api/client";

/**
 * Notifications.
 *
 * Tapping one marks it read and, where the notification points at something,
 * goes there. A notification that cannot take you to the thing it is about is
 * only half a notification.
 */
export default function NotificationsScreen() {
  const colors = useColors();
  const router = useRouter();
  const query = useNotifications();
  const markRead = useMarkNotificationRead();

  // Web routes are mapped to screens in one place (src/notifications/deepLink)
  // so a tap here and a tap on a push notification agree.
  const openFor = (actionUrl?: string | null) => {
    if (!actionUrl) return;
    const target = routeForActionUrl(actionUrl);
    if (target !== "/(app)/notifications") router.push(target);
  };

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
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.lg }}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Txt variant="title" style={{ marginLeft: spacing.sm }}>
            Notifications
          </Txt>
        </View>

        {query.isLoading ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState
            message={query.error instanceof ApiError ? query.error.message : "Could not load these."}
            onRetry={query.refetch}
          />
        ) : (query.data ?? []).length === 0 ? (
          <Card>
            <EmptyState
              icon="notifications-off-outline"
              title="Nothing yet"
              body="You will be told here when leave is approved, a correction is reviewed, or a payslip is published."
            />
          </Card>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {(query.data ?? []).map((item) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  if (!item.isRead) markRead.mutate(item.id);
                  openFor(item.actionUrl);
                }}
                accessibilityRole="button"
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <Card style={!item.isRead ? { borderColor: colors.brand[300] } : undefined}>
                  <View style={{ flexDirection: "row" }}>
                    {!item.isRead && (
                      <View
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: radius.full,
                          backgroundColor: colors.brand[600],
                          marginTop: 6,
                          marginRight: spacing.sm,
                        }}
                      />
                    )}
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyMedium">{item.title}</Txt>
                      <Txt variant="caption" tone="muted" style={{ marginTop: 3, lineHeight: 19 }}>
                        {item.body}
                      </Txt>
                      <Txt variant="caption" tone="subtle" style={{ marginTop: 6 }}>
                        {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                      </Txt>
                    </View>
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        )}
      </Screen>
    </SafeAreaView>
  );
}
