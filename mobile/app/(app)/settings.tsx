import { useEffect, useState } from "react";
import { Alert, Pressable, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { useTheme } from "../../src/theme/ThemeProvider";
import {
  appLockCapability,
  isAppLockEnabled,
  setAppLockEnabled,
} from "../../src/auth/AppLockGate";
import { getBaseUrl } from "../../src/api/client";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "../../src/api/hooks";
import { registerForPush } from "../../src/notifications/push";
import { Card, Divider, Row, Screen, SectionHeader, Txt } from "../../src/components/ui";
import { spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";
import { ServerSheet } from "../../src/components/ServerSheet";
import { BRAND } from "../../src/brand";

/**
 * Settings.
 *
 * Each toggle here reflects something the device or the OS actually reports,
 * rather than a preference the app stores and hopes matches reality. A
 * notifications switch that says "on" while the OS has them blocked is worse
 * than no switch at all.
 */
export default function Settings() {
  const { preference, setPreference, colors } = useTheme();
  const router = useRouter();
  const toast = useToast();

  const [lockEnabled, setLockEnabled] = useState(false);
  const [lockCapability, setLockCapability] = useState<{
    supported: boolean;
    enrolled: boolean;
    label: string;
  } | null>(null);
  const [notificationsGranted, setNotificationsGranted] = useState<boolean | null>(null);
  const [serverOpen, setServerOpen] = useState(false);
  const [baseUrl, setBaseUrlLabel] = useState("");
  const preferences = useNotificationPreferences();
  const updatePreferences = useUpdateNotificationPreferences();

  useEffect(() => {
    isAppLockEnabled().then(setLockEnabled);
    appLockCapability().then(setLockCapability);
    Notifications.getPermissionsAsync()
      .then((result) => setNotificationsGranted(result.granted))
      .catch(() => setNotificationsGranted(null));
    getBaseUrl().then(setBaseUrlLabel);
  }, []);

  const toggleLock = async (next: boolean) => {
    if (next && lockCapability && !lockCapability.enrolled) {
      Alert.alert(
        "Nothing to unlock with",
        "Set up a fingerprint, face unlock or a passcode on your phone first, then turn this on.",
        [{ text: "OK" }]
      );
      return;
    }
    setLockEnabled(next);
    await setAppLockEnabled(next);
    toast.success(next ? "The app will ask to unlock." : "App lock turned off.");
  };

  const requestNotifications = async () => {
    const result = await Notifications.requestPermissionsAsync();
    setNotificationsGranted(result.granted);
    if (!result.granted) {
      Alert.alert(
        "Notifications are off",
        `You can turn them on for ${BRAND.name} in your phone's Settings. Without them you will not be told when leave is approved or a payslip is published.`,
        [{ text: "OK" }]
      );
      return;
    }
    // Permission alone delivers nothing: the device has to be registered.
    const token = await registerForPush({ ask: true });
    if (token) toast.success("This phone will receive notifications.");
    else toast.error("Could not register this phone for push. Try again later.");
  };

  const setNotificationPreference = async (patch: { emailEnabled?: boolean; pushEnabled?: boolean; dailyDigest?: boolean }) => {
    try {
      await updatePreferences.mutateAsync(patch);
    } catch {
      toast.error("Could not save that preference.");
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.lg }}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Txt variant="title" style={{ marginLeft: spacing.sm }}>
            Settings
          </Txt>
        </View>

        <SectionHeader title="Appearance" />
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          {(["system", "light", "dark"] as const).map((option, index) => (
            <View key={option}>
              {index > 0 && <Divider />}
              <Row
                icon={
                  option === "system"
                    ? "phone-portrait-outline"
                    : option === "light"
                      ? "sunny-outline"
                      : "moon-outline"
                }
                title={
                  option === "system"
                    ? "Follow my phone"
                    : option === "light"
                      ? "Always light"
                      : "Always dark"
                }
                onPress={() => setPreference(option)}
                right={
                  preference === option ? (
                    <Ionicons name="checkmark" size={19} color={colors.brand[600]} />
                  ) : (
                    <View style={{ width: 19 }} />
                  )
                }
              />
            </View>
          ))}
        </Card>

        <SectionHeader title="Security" />
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          <Row
            icon="finger-print-outline"
            title="Require unlock"
            subtitle={
              lockCapability && !lockCapability.supported
                ? "This phone has no biometric hardware"
                : lockCapability && !lockCapability.enrolled
                  ? "Set up a fingerprint, face or passcode first"
                  : `Ask for ${lockCapability?.label ?? "unlock"} after a minute away`
            }
            right={
              <Switch
                value={lockEnabled}
                onValueChange={toggleLock}
                disabled={Boolean(lockCapability && !lockCapability.supported)}
                trackColor={{ true: colors.brand[500], false: colors.borderStrong }}
              />
            }
          />
        </Card>

        <SectionHeader title="Notifications" />
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          <Row
            icon="notifications-outline"
            title="Push notifications"
            subtitle={
              notificationsGranted === null
                ? "Checking…"
                : notificationsGranted
                  ? "On — you will be told about approvals and payslips"
                  : "Off — tap to turn on"
            }
            onPress={notificationsGranted ? undefined : requestNotifications}
            right={
              notificationsGranted ? (
                <Ionicons name="checkmark-circle" size={19} color={colors.success} />
              ) : undefined
            }
          />
          <Divider />
          <Row
            icon="phone-portrait-outline"
            title="Push to this account"
            subtitle="Approvals, payslips and reminders on your phone"
            right={
              <Switch
                value={preferences.data?.pushEnabled ?? true}
                onValueChange={(value) => setNotificationPreference({ pushEnabled: value })}
                disabled={preferences.isLoading}
                trackColor={{ true: colors.brand[500], false: colors.borderStrong }}
              />
            }
          />
          <Divider />
          <Row
            icon="mail-outline"
            title="Email"
            subtitle="Copies of important notices to your work email"
            right={
              <Switch
                value={preferences.data?.emailEnabled ?? true}
                onValueChange={(value) => setNotificationPreference({ emailEnabled: value })}
                disabled={preferences.isLoading}
                trackColor={{ true: colors.brand[500], false: colors.borderStrong }}
              />
            }
          />
        </Card>

        <SectionHeader title="Connection" />
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          <Row
            icon="server-outline"
            title="Server"
            subtitle={baseUrl}
            onPress={async () => {
              setBaseUrlLabel(await getBaseUrl());
              setServerOpen(true);
            }}
          />
        </Card>

        <SectionHeader title="About" />
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          <Row icon="information-circle-outline" title="Version" right={<Txt variant="label" tone="muted">{BRAND.version}</Txt>} />
          <Divider />
          <Row
            icon="help-circle-outline"
            title="Help and support"
            onPress={() => router.push("/(app)/help")}
          />
        </Card>
      </Screen>

      <ServerSheet open={serverOpen} currentUrl={baseUrl} onClose={() => setServerOpen(false)} />
    </SafeAreaView>
  );
}
