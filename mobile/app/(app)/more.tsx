import { Alert, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useSession } from "../../src/auth/session";
import { useProfile, useUnreadCount } from "../../src/api/hooks";
import { useColors } from "../../src/theme/ThemeProvider";
import { Card, Divider, Row, Screen, SectionHeader, Txt } from "../../src/components/ui";
import { radius, spacing } from "../../src/theme";
import { versionLabel } from "../../src/brand";
import { fontStyle } from "../../src/theme/fonts";

/**
 * Everything that does not earn a tab.
 *
 * Grouped by what the person is trying to do rather than by which module the
 * feature belongs to: "my things", "help", "app". Nobody opens this screen
 * looking for the notifications module.
 */
export default function More() {
  const { session, signOut } = useSession();
  const router = useRouter();
  const colors = useColors();
  const profile = useProfile();
  const unread = useUnreadCount();

  const confirmSignOut = () => {
    Alert.alert("Sign out?", "You will need your password to sign back in.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  const employee = profile.data;
  const initials = `${session?.user.firstName?.[0] ?? ""}${session?.user.lastName?.[0] ?? ""}`
    .toUpperCase()
    .trim();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen>
        <Txt variant="title" style={{ marginBottom: spacing.lg }}>
          More
        </Txt>

        {/* Identity card */}
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {employee?.avatarUrl ? (
              <Image
                source={{ uri: employee.avatarUrl }}
                style={{ width: 52, height: 52, borderRadius: radius.full }}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: radius.full,
                  backgroundColor: colors.brand[100],
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Txt variant="heading" tone="brand">
                  {initials || "?"}
                </Txt>
              </View>
            )}

            <View style={{ flex: 1, marginLeft: spacing.md, minWidth: 0 }}>
              <Txt variant="bodyMedium" numberOfLines={1}>
                {session?.user.fullName ?? session?.user.email}
              </Txt>
              <Txt variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
                {employee?.employeeCode ? `${employee.employeeCode} · ` : ""}
                {typeof employee?.employment?.designation === "string"
                  ? employee.employment.designation
                  : employee?.employment?.designation?.name ?? session?.organization?.name ?? ""}
              </Txt>
            </View>
          </View>
        </Card>

        <SectionHeader title="Your records" />
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          <Row
            icon="person-outline"
            title="Profile"
            subtitle="Your details and employment information"
            onPress={() => router.push("/(app)/profile")}
          />
          <Divider />
          <Row
            icon="folder-outline"
            title="Documents"
            subtitle="Everything your employer has shared with you"
            onPress={() => router.push("/(app)/documents")}
          />
          <Divider />
          <Row
            icon="sunny-outline"
            title="Holidays"
            subtitle="Your holiday calendar for the year"
            onPress={() => router.push("/(app)/holidays")}
          />
          <Divider />
          <Row
            icon="clipboard-outline"
            title="Requests"
            subtitle="Work from home, comp-off, advances"
            onPress={() => router.push("/(app)/requests")}
          />
          <Divider />
          <Row
            icon="receipt-outline"
            title="Expenses"
            subtitle="Claim what you spent for work"
            onPress={() => router.push("/(app)/expenses")}
          />
          <Divider />
          <Row
            icon="cash-outline"
            title="Loans and advances"
            subtitle="Ask, and follow the repayments"
            onPress={() => router.push("/(app)/loans")}
          />
          <Divider />
          <Row
            icon="laptop-outline"
            title="My assets"
            subtitle="Equipment in your care"
            onPress={() => router.push("/(app)/assets")}
          />
          <Divider />
          <Row
            icon="help-buoy-outline"
            title="Help desk"
            subtitle="Raise a ticket with IT, HR or payroll"
            onPress={() => router.push("/(app)/tickets")}
          />
          <Divider />
          <Row
            icon="flag-outline"
            title="My performance"
            subtitle="Goals and reviews"
            onPress={() => router.push("/(app)/performance")}
          />
          <Divider />
          <Row
            icon="chatbubbles-outline"
            title="Surveys"
            subtitle="Questions from HR, a couple of minutes each"
            onPress={() => router.push("/(app)/surveys")}
          />
          <Divider />
          <Row
            icon="notifications-outline"
            title="Notifications"
            subtitle={unread.data ? `${unread.data} unread` : "Everything you have been sent"}
            onPress={() => router.push("/(app)/notifications")}
            right={
              unread.data ? (
                <View
                  style={{
                    minWidth: 20,
                    height: 20,
                    borderRadius: radius.full,
                    backgroundColor: colors.danger,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 5,
                  }}
                >
                  <Txt variant="caption" style={[{ color: colors.onBrand }, fontStyle("700")]}>
                    {unread.data > 99 ? "99+" : unread.data}
                  </Txt>
                </View>
              ) : undefined
            }
          />
        </Card>

        <SectionHeader title="Help" />
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          <Row
            icon="help-circle-outline"
            title="Help and support"
            subtitle="How things work, and how to reach a person"
            onPress={() => router.push("/(app)/help")}
          />
        </Card>

        <SectionHeader title="App" />
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          <Row
            icon="settings-outline"
            title="Settings"
            subtitle="Appearance, security and notifications"
            onPress={() => router.push("/(app)/settings")}
          />
          <Divider />
          <Row icon="log-out-outline" title="Sign out" danger onPress={confirmSignOut} />
        </Card>

        <Txt variant="caption" tone="subtle" style={{ textAlign: "center", marginTop: spacing["3xl"] }}>
          {versionLabel()}
        </Txt>
      </Screen>
    </SafeAreaView>
  );
}
