import { Pressable, RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { format, isPast, parseISO } from "date-fns";
import { useHolidays } from "../../src/api/hooks";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Card, EmptyState, Loading, Screen, Txt } from "../../src/components/ui";
import { radius, spacing } from "../../src/theme";

/**
 * The holiday calendar.
 *
 * Past holidays are kept but dimmed rather than dropped: people scroll back to
 * check whether a day they took was a holiday, and a list that silently hides
 * them makes that impossible.
 */
export default function Holidays() {
  const colors = useColors();
  const router = useRouter();
  const query = useHolidays();

  const sorted = [...(query.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));

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
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Txt variant="title" style={{ marginLeft: spacing.sm }}>
            Holidays
          </Txt>
        </View>

        {query.isLoading ? (
          <Loading />
        ) : sorted.length === 0 ? (
          <Card>
            <EmptyState
              icon="sunny-outline"
              title="No holidays listed"
              body="Your employer has not published a holiday calendar for your location yet."
            />
          </Card>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {sorted.map((holiday) => {
              const past = isPast(parseISO(holiday.date));
              return (
                <Card key={holiday.id} style={past ? { opacity: 0.5 } : undefined}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View
                      style={{
                        width: 48,
                        borderRadius: radius.md,
                        backgroundColor: colors.warningBg,
                        paddingVertical: 6,
                        alignItems: "center",
                        marginRight: spacing.md,
                      }}
                    >
                      <Txt variant="caption" tone="warning">
                        {format(parseISO(holiday.date), "MMM").toUpperCase()}
                      </Txt>
                      <Txt variant="heading" tone="warning">
                        {format(parseISO(holiday.date), "d")}
                      </Txt>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt variant="bodyMedium" numberOfLines={1}>
                        {holiday.name}
                      </Txt>
                      <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
                        {format(parseISO(holiday.date), "EEEE")}
                      </Txt>
                    </View>
                    {holiday.isOptional && <Badge label="Optional" tone="info" />}
                  </View>
                </Card>
              );
            })}
          </View>
        )}
      </Screen>
    </SafeAreaView>
  );
}
