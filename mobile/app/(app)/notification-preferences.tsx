import { useEffect, useState } from "react";
import { Alert, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { NOTIFICATION_CATEGORY_LABELS, useNotificationPreferences, usePushDevices, useTestPush, useUpdateNotificationPreferences, type NotificationPreferences } from "../../src/api/hooks";
import { registerForPush } from "../../src/notifications/push";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, Divider, Field, Loading, Screen, SectionHeader, Txt } from "../../src/components/ui";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { Note, ToggleRow } from "../../src/components/Sheet";
import { radius, spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";
import { ApiError } from "../../src/api/client";
import { BRAND } from "../../src/brand";
import { relative } from "../../src/lib/format";

/**
 * How this person wants to be reached — the web portal's notification
 * preferences panel. In-app is always on; email and push can be turned off
 * entirely or per topic, push can be silenced overnight, and this phone can
 * be enrolled from here.
 */
export default function NotificationPreferencesScreen() {
  const colors = useColors();
  const toast = useToast();
  const preferences = useNotificationPreferences();
  const save = useUpdateNotificationPreferences();
  const devices = usePushDevices();
  const test = useTestPush();
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  const [dirty, setDirty] = useState(false);
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    if (preferences.data) {
      setDraft(preferences.data);
      setDirty(false);
    }
  }, [preferences.data]);

  useEffect(() => {
    Notifications.getPermissionsAsync()
      .then((r) => setGranted(r.granted))
      .catch(() => setGranted(null));
  }, []);

  const patch = (changes: Partial<NotificationPreferences>) => {
    if (!draft) return;
    setDraft({ ...draft, ...changes });
    setDirty(true);
  };

  const isMuted = (category: string, channel: "email" | "push") => Boolean(draft?.muted.some((m) => m.category === category && m.channel === channel));
  const toggleMute = (category: string, channel: "email" | "push") => {
    if (!draft) return;
    const muted = isMuted(category, channel) ? draft.muted.filter((m) => !(m.category === category && m.channel === channel)) : [...draft.muted, { category, channel }];
    patch({ muted });
  };

  const onSave = async () => {
    if (!draft) return;
    try {
      await save.mutateAsync(draft);
      toast.success("Preferences saved.");
      setDirty(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not save your preferences.");
    }
  };

  const enrolThisPhone = async () => {
    const result = await Notifications.requestPermissionsAsync();
    setGranted(result.granted);
    if (!result.granted) {
      Alert.alert("Notifications are off", `Turn them on for ${BRAND.name} in your phone's Settings, then come back here.`, [{ text: "OK" }]);
      return;
    }
    const token = await registerForPush({ ask: true });
    if (token) {
      toast.success("This phone will receive notifications.");
      devices.refetch();
    } else toast.error("Could not register this phone for push. Try again later.");
  };

  const sendTest = async () => {
    try {
      const result = await test.mutateAsync();
      if (result.noDevices) toast.error("No devices are registered yet. Enrol this phone first.");
      else toast.success(`Test sent: ${result.delivered} of ${result.attempted} device(s) accepted it.`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not send a test.");
    }
  };

  const categories = draft?.categories || Object.keys(NOTIFICATION_CATEGORY_LABELS);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={preferences.isRefetching} onRefresh={preferences.refetch} tintColor={colors.brand[600]} />}>
        <ScreenHeader title="Notification preferences" action={dirty ? <Button title="Save" size="sm" icon="save-outline" onPress={onSave} loading={save.isPending} /> : undefined} />

        {!draft ? (
          <Loading />
        ) : (
          <>
            <Card>
              <Txt variant="caption" tone="muted" style={{ marginBottom: spacing.sm, lineHeight: 18 }}>
                In-app notifications are always kept, so nothing is lost. Choose what also reaches your inbox and your phone.
              </Txt>
              <ToggleRow label="Email" hint="Turn off to stop every email except account security notices and password resets." value={draft.emailEnabled} onChange={(v) => patch({ emailEnabled: v })} />
              <Divider />
              <ToggleRow label="Push notifications" hint="To this phone and any browser you have enrolled." value={draft.pushEnabled} onChange={(v) => patch({ pushEnabled: v })} />
              <Divider />
              <ToggleRow label="Morning digest" hint="One email a day summarising what is waiting on you. Only sent when there is something in it." value={draft.dailyDigest} onChange={(v) => patch({ dailyDigest: v })} />
            </Card>

            <SectionHeader title="By topic" />
            <Card>
              <Txt variant="caption" tone="muted" style={{ marginBottom: spacing.sm }}>
                Untick a channel for a topic you would rather only see in the app.
              </Txt>
              <View style={{ flexDirection: "row", paddingVertical: 6 }}>
                <Txt variant="caption" tone="subtle" style={{ flex: 1, textTransform: "uppercase" }}>
                  Topic
                </Txt>
                <Txt variant="caption" tone="subtle" style={{ width: 64, textAlign: "center", textTransform: "uppercase" }}>
                  Email
                </Txt>
                <Txt variant="caption" tone="subtle" style={{ width: 64, textAlign: "center", textTransform: "uppercase" }}>
                  Push
                </Txt>
              </View>
              {categories.map((category) => (
                <View key={category} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Txt variant="body" style={{ flex: 1 }}>
                    {NOTIFICATION_CATEGORY_LABELS[category] || category}
                  </Txt>
                  {(["email", "push"] as const).map((channel) => {
                    const masterOff = channel === "email" ? !draft.emailEnabled : !draft.pushEnabled;
                    const on = !masterOff && !isMuted(category, channel);
                    return (
                      <View key={channel} style={{ width: 64, alignItems: "center", opacity: masterOff ? 0.35 : 1 }}>
                        <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.brand[600] : colors.textSubtle} onPress={() => !masterOff && toggleMute(category, channel)} />
                      </View>
                    );
                  })}
                </View>
              ))}
            </Card>

            <SectionHeader title="Quiet hours" />
            <Card>
              <ToggleRow label="Quiet hours" hint="No push notifications between these times. They still appear in the app, and emails are unaffected." value={draft.quietHours.enabled} onChange={(v) => patch({ quietHours: { ...draft.quietHours, enabled: v } })} />
              {draft.quietHours.enabled && (
                <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Field label="From (HH:MM)" value={draft.quietHours.start} onChangeText={(v) => patch({ quietHours: { ...draft.quietHours, start: v } })} placeholder="22:00" maxLength={5} keyboardType="numbers-and-punctuation" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="Until (HH:MM)" value={draft.quietHours.end} onChangeText={(v) => patch({ quietHours: { ...draft.quietHours, end: v } })} placeholder="07:00" maxLength={5} keyboardType="numbers-and-punctuation" />
                  </View>
                </View>
              )}
            </Card>

            <Button title="Save preferences" onPress={onSave} loading={save.isPending} disabled={!dirty} style={{ marginTop: spacing.lg }} />

            <SectionHeader title="Your devices" action={<Button title="Send a test" variant="ghost" size="sm" icon="notifications-outline" onPress={sendTest} loading={test.isPending} />} />
            <Card>
              {granted ? (
                <Note tone="success">This phone is enrolled for notifications.</Note>
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyMedium">Get notified on this phone</Txt>
                    <Txt variant="caption" tone="muted">
                      Approvals and payslips will reach you even when the app is closed.
                    </Txt>
                  </View>
                  <Button title="Enable" size="sm" onPress={enrolThisPhone} />
                </View>
              )}
              {devices.isLoading ? (
                <Loading />
              ) : !devices.data?.length ? (
                <Txt variant="caption" tone="muted">
                  No devices registered yet.
                </Txt>
              ) : (
                devices.data.map((device, index) => (
                  <View key={device.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderTopWidth: index || granted ? 1 : 0, borderTopColor: colors.border }}>
                    <View style={{ width: 32, height: 32, borderRadius: radius.md, backgroundColor: colors.surfaceSunken, alignItems: "center", justifyContent: "center", marginRight: spacing.md }}>
                      <Ionicons name={device.kind === "web" ? "laptop-outline" : "phone-portrait-outline"} size={16} color={colors.textMuted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Txt variant="label" numberOfLines={1}>
                        {device.deviceName || (device.kind === "web" ? "Browser" : `Mobile app (${device.platform})`)}
                        {device.appVersion ? ` v${device.appVersion}` : ""}
                      </Txt>
                      <Txt variant="caption" tone="subtle">
                        Seen {relative(device.lastSeenAt)}
                        {device.lastDeliveredAt ? ` · last delivered ${relative(device.lastDeliveredAt)}` : ""}
                      </Txt>
                    </View>
                    {device.isActive ? <Badge label="Active" tone="success" /> : <Badge label={`Retired${device.disabledReason ? `: ${device.disabledReason}` : ""}`} tone="neutral" />}
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
