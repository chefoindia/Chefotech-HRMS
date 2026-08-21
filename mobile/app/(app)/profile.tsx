import { Pressable, RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { format } from "date-fns";
import { useProfile } from "../../src/api/hooks";
import { useSession } from "../../src/auth/session";
import { useColors } from "../../src/theme/ThemeProvider";
import { Card, ErrorState, Loading, Screen, SectionHeader, Txt } from "../../src/components/ui";
import { radius, spacing } from "../../src/theme";
import { ApiError } from "../../src/api/client";

/**
 * The employee's own record.
 *
 * Read-only, and honest about why. Designation, department, joining date and
 * pay are contractual facts maintained by HR — showing them as editable fields
 * that silently fail to save would be worse than showing them as facts with a
 * note about who to ask.
 */
export default function Profile() {
  const colors = useColors();
  const router = useRouter();
  const { session } = useSession();
  const query = useProfile();

  const employee = query.data;
  const name = (value: unknown) =>
    typeof value === "string" ? value : (value as { name?: string })?.name ?? "—";

  const initials = `${session?.user.firstName?.[0] ?? ""}${session?.user.lastName?.[0] ?? ""}`
    .toUpperCase()
    .trim();

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
            Profile
          </Txt>
        </View>

        {query.isLoading ? (
          <Loading label="Loading your profile…" />
        ) : query.isError ? (
          <ErrorState
            message={
              query.error instanceof ApiError ? query.error.message : "Could not load your profile."
            }
            onRetry={query.refetch}
          />
        ) : (
          <>
            <Card>
              <View style={{ alignItems: "center", paddingVertical: spacing.md }}>
                {employee?.avatarUrl ? (
                  <Image
                    source={{ uri: employee.avatarUrl }}
                    style={{ width: 84, height: 84, borderRadius: radius.full }}
                    contentFit="cover"
                    transition={200}
                  />
                ) : (
                  <View
                    style={{
                      width: 84,
                      height: 84,
                      borderRadius: radius.full,
                      backgroundColor: colors.brand[100],
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Txt variant="display" tone="brand">
                      {initials || "?"}
                    </Txt>
                  </View>
                )}

                <Txt variant="heading" style={{ marginTop: spacing.md }}>
                  {employee?.fullName ??
                    `${employee?.firstName ?? ""} ${employee?.lastName ?? ""}`.trim() ??
                    session?.user.fullName}
                </Txt>
                <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
                  {name(employee?.employment?.designation)}
                </Txt>
                {employee?.employeeCode && (
                  <Txt variant="caption" tone="subtle" style={{ marginTop: 4 }}>
                    {employee.employeeCode}
                  </Txt>
                )}
              </View>
            </Card>

            <SectionHeader title="Contact" />
            <Card>
              <Detail label="Work email" value={employee?.workEmail ?? session?.user.email ?? "—"} />
              <Detail label="Personal email" value={employee?.personalEmail ?? "—"} />
              <Detail label="Phone" value={employee?.phone ?? "—"} last />
            </Card>

            <SectionHeader title="Employment" />
            <Card>
              <Detail label="Department" value={name(employee?.employment?.department)} />
              <Detail label="Location" value={name(employee?.employment?.location)} />
              <Detail
                label="Employment type"
                value={
                  employee?.employment?.employmentType
                    ?.replace(/_/g, " ")
                    .replace(/^./, (c) => c.toUpperCase()) ?? "—"
                }
              />
              <Detail
                label="Joined"
                value={
                  employee?.employment?.joiningDate
                    ? format(new Date(employee.employment.joiningDate), "d MMMM yyyy")
                    : "—"
                }
              />
              <Detail label="Reports to" value={employee?.employment?.managerName ?? "—"} last />
            </Card>

            <Card style={{ marginTop: spacing.lg, backgroundColor: colors.infoBg, borderColor: colors.info }}>
              <View style={{ flexDirection: "row" }}>
                <Ionicons name="information-circle-outline" size={18} color={colors.info} />
                <Txt variant="caption" tone="muted" style={{ flex: 1, marginLeft: spacing.sm, lineHeight: 19 }}>
                  These details are maintained by your HR team. If something here is wrong, contact
                  them — changes made anywhere else would not reach your official record.
                </Txt>
              </View>
            </Card>
          </>
        )}
      </Screen>
    </SafeAreaView>
  );
}

function Detail({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: spacing.md,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <Txt variant="label" tone="muted" style={{ flex: 1 }}>
        {label}
      </Txt>
      <Txt variant="label" style={{ flex: 1.4, textAlign: "right" }} numberOfLines={2}>
        {value}
      </Txt>
    </View>
  );
}
