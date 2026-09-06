import { useState } from "react";
import { Alert, Pressable, RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  NOTIFICATION_CATEGORY_LABELS,
  useAcknowledgeAnnouncement,
  useAnnouncements,
  useClearReadNotifications,
  useDeleteNotification,
  useMarkNotificationRead,
  useMarkNotificationUnread,
  useMarkNotificationsRead,
  useNotificationSummary,
  useNotifications,
  type NotificationItem,
} from "../../src/api/hooks";
import { routeForActionUrl } from "../../src/notifications/deepLink";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Loading, Screen, Txt } from "../../src/components/ui";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { CheckRow, TabStrip } from "../../src/components/Sheet";
import { radius, spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";
import { ApiError } from "../../src/api/client";
import { dateTimeLabel, humanise, relative } from "../../src/lib/format";

const SEVERITY_TONE: Record<string, "info" | "success" | "warning" | "danger"> = { info: "info", success: "success", warning: "warning", critical: "danger" };

/**
 * The notification centre — the web portal's /me/notifications: the whole
 * record, searchable and filterable by topic, plus the noticeboard with its
 * acknowledgement buttons.
 */
export default function NotificationsScreen() {
  const colors = useColors();
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);

  const summary = useNotificationSummary();
  const list = useNotifications({ page, q: search, unreadOnly, category: tab !== "all" && tab !== "announcements" ? tab : undefined });
  const announcements = useAnnouncements();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkNotificationsRead();
  const markUnread = useMarkNotificationUnread();
  const remove = useDeleteNotification();
  const clearRead = useClearReadNotifications();
  const acknowledge = useAcknowledgeAnnouncement();

  const totalUnread = (summary.data || []).reduce((sum, row) => sum + row.unread, 0);
  const byCategory = Object.fromEntries((summary.data || []).map((row) => [row.category, row]));
  const tabs = [
    { key: "all", label: "All", count: totalUnread || undefined },
    { key: "announcements", label: "Announcements" },
    ...Object.keys(NOTIFICATION_CATEGORY_LABELS)
      .filter((key) => key !== "announcement" && byCategory[key])
      .map((key) => ({ key, label: NOTIFICATION_CATEGORY_LABELS[key], count: byCategory[key]?.unread || undefined })),
  ];

  const openFor = (item: NotificationItem) => {
    if (!item.readAt) markRead.mutate(item.id);
    if (!item.actionUrl) return;
    const target = routeForActionUrl(item.actionUrl);
    if (target !== "/(app)/notifications") router.push(target);
  };

  const confirmClear = () =>
    Alert.alert("Clear read notifications?", "Unread ones are kept.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () =>
          clearRead
            .mutateAsync(undefined)
            .then((r) => {
              const deleted = (r as { data?: { deleted?: number } })?.data?.deleted;
              toast.success(typeof deleted === "number" ? `${deleted} read notification${deleted === 1 ? "" : "s"} cleared.` : "Read notifications cleared.");
            })
            .catch(() => toast.error("Could not clear them.")),
      },
    ]);

  const items = list.data?.items || [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching}
            onRefresh={() => {
              list.refetch();
              summary.refetch();
              announcements.refetch();
            }}
            tintColor={colors.brand[600]}
          />
        }
      >
        <ScreenHeader
          title="Notifications"
          action={
            <View style={{ flexDirection: "row", gap: spacing.xs }}>
              <Pressable onPress={() => markAll.mutate(undefined)} disabled={!totalUnread} hitSlop={8} accessibilityRole="button" accessibilityLabel="Mark all read" style={{ padding: spacing.sm, opacity: totalUnread ? 1 : 0.4 }}>
                <Ionicons name="checkmark-done-outline" size={22} color={colors.brand[600]} />
              </Pressable>
              <Pressable onPress={confirmClear} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear read" style={{ padding: spacing.sm }}>
                <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
              </Pressable>
            </View>
          }
        />
        <Txt variant="caption" tone="muted" style={{ marginBottom: spacing.md }}>
          {totalUnread ? `${totalUnread} unread. ` : ""}Everything you have been told, in one place.
        </Txt>

        <TabStrip
          items={tabs}
          active={tab}
          onChange={(key) => {
            setTab(key);
            setPage(1);
          }}
        />

        {tab === "announcements" ? (
          announcements.isLoading ? (
            <Loading />
          ) : !announcements.data?.length ? (
            <Card>
              <EmptyState icon="megaphone-outline" title="No announcements yet" body="Company-wide notices from HR appear here, with the ones that need your acknowledgement marked." />
            </Card>
          ) : (
            <View style={{ gap: spacing.md }}>
              {announcements.data.map((a) => {
                const pinned = a.pinnedUntil && new Date(a.pinnedUntil) > new Date();
                return (
                  <Card key={a.id} style={pinned ? { borderColor: colors.brand[300] } : undefined}>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm }}>
                      <Txt variant="heading" style={{ flex: 1 }}>
                        {a.title}
                      </Txt>
                      {pinned && <Badge label="Pinned" tone="brand" />}
                      {a.requireAcknowledgement && (a.acknowledged ? <Badge label="Acknowledged" tone="success" /> : <Badge label="Acknowledgement needed" tone="warning" />)}
                    </View>
                    <Txt variant="caption" tone="subtle" style={{ marginTop: 2 }}>
                      {a.createdBy ? `${a.createdBy} · ` : ""}
                      {dateTimeLabel(a.sentAt || a.createdAt)}
                    </Txt>
                    <Txt variant="body" style={{ marginTop: spacing.md, lineHeight: 21 }}>
                      {a.message}
                    </Txt>
                    {a.requireAcknowledgement && !a.acknowledged && (
                      <View style={{ marginTop: spacing.md, alignSelf: "flex-start" }}>
                        <Button title="I have read this" size="sm" icon="checkmark-outline" loading={acknowledge.isPending && acknowledge.variables === a.id} onPress={() => acknowledge.mutateAsync(a.id).then(() => toast.success("Acknowledged. HR can see you have read it.")).catch((e) => toast.error(e instanceof ApiError ? e.message : "Could not record your acknowledgement."))} />
                      </View>
                    )}
                    {a.acknowledged && a.acknowledgedAt ? (
                      <Txt variant="caption" tone="subtle" style={{ marginTop: spacing.sm }}>
                        You acknowledged this {relative(a.acknowledgedAt)}.
                      </Txt>
                    ) : null}
                  </Card>
                );
              })}
            </View>
          )
        ) : (
          <>
            <Field
              placeholder="Search notifications"
              icon="search-outline"
              value={search}
              onChangeText={(v) => {
                setSearch(v);
                setPage(1);
              }}
              autoCapitalize="none"
            />
            <View style={{ marginTop: -spacing.md, marginBottom: spacing.sm }}>
              <CheckRow
                label="Unread only"
                checked={unreadOnly}
                onChange={(v) => {
                  setUnreadOnly(v);
                  setPage(1);
                }}
              />
            </View>

            {list.isLoading ? (
              <Loading />
            ) : list.isError ? (
              <ErrorState message={list.error instanceof ApiError ? list.error.message : "Could not load these."} onRetry={list.refetch} />
            ) : items.length === 0 ? (
              <Card>
                <EmptyState icon="notifications-off-outline" title={search || unreadOnly ? "Nothing matches" : "Nothing yet"} body={search || unreadOnly ? "Try a different search, or include read notifications." : "Approvals, payslips, documents and reminders will appear here."} />
              </Card>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {items.map((item) => {
                  const unread = !item.readAt;
                  return (
                    <Card key={item.id} style={unread ? { borderColor: colors.brand[300] } : undefined}>
                      <Pressable onPress={() => openFor(item)} accessibilityRole="button">
                        <View style={{ flexDirection: "row" }}>
                          <View style={{ width: 7, height: 7, borderRadius: radius.full, backgroundColor: unread ? colors.brand[600] : "transparent", marginTop: 6, marginRight: spacing.sm }} />
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                              <Txt variant={unread ? "bodyMedium" : "body"} style={{ flexShrink: 1 }}>
                                {item.title}
                              </Txt>
                              <Badge label={NOTIFICATION_CATEGORY_LABELS[item.category] || humanise(item.category)} tone={SEVERITY_TONE[item.severity] || "info"} />
                            </View>
                            <Txt variant="caption" tone="muted" style={{ marginTop: 3, lineHeight: 19 }}>
                              {item.body}
                            </Txt>
                            <Txt variant="caption" tone="subtle" style={{ marginTop: 6 }}>
                              {relative(item.createdAt)}
                            </Txt>
                          </View>
                        </View>
                      </Pressable>
                      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: spacing.md, marginTop: spacing.sm }}>
                        <Pressable onPress={() => (unread ? markRead.mutate(item.id) : markUnread.mutate(item.id))} hitSlop={8} accessibilityRole="button" accessibilityLabel={unread ? "Mark read" : "Mark unread"}>
                          <Txt variant="caption" tone="brand">
                            {unread ? "Mark read" : "Mark unread"}
                          </Txt>
                        </Pressable>
                        <Pressable onPress={() => remove.mutate(item.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete">
                          <Txt variant="caption" tone="danger">
                            Delete
                          </Txt>
                        </Pressable>
                      </View>
                    </Card>
                  );
                })}
                {list.data && list.data.totalPages > 1 && (
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm }}>
                    <Txt variant="caption" tone="muted">
                      Page {page} of {list.data.totalPages} · {list.data.total} total
                    </Txt>
                    <View style={{ flexDirection: "row", gap: spacing.sm }}>
                      <Button title="Previous" variant="secondary" size="sm" disabled={page <= 1} onPress={() => setPage((p) => p - 1)} />
                      <Button title="Next" variant="secondary" size="sm" disabled={page >= list.data.totalPages} onPress={() => setPage((p) => p + 1)} />
                    </View>
                  </View>
                )}
              </View>
            )}
          </>
        )}
      </Screen>
    </SafeAreaView>
  );
}
