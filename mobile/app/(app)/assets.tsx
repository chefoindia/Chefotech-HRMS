import { Alert, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { format } from "date-fns";
import { useAcknowledgeAsset, useMyAssets } from "../../src/api/hooks";
import { useSession } from "../../src/auth/session";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, Divider, EmptyState, ErrorState, Loading, Screen, Txt } from "../../src/components/ui";
import { ScreenHeader, humanise } from "../../src/components/ScreenHeader";
import { spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";

/** What the company has handed me, and a one-tap "yes, I have it". */
export default function Assets() {
  const colors = useColors();
  const toast = useToast();
  const { session } = useSession();
  const query = useMyAssets();
  const acknowledge = useAcknowledgeAsset();

  const confirm = (id: string, name: string) =>
    Alert.alert("Confirm you received this", `${name}. Your name is recorded as the signature.`, [
      { text: "Not yet", style: "cancel" },
      { text: "I have it", onPress: () => acknowledge.mutate({ id, name: session?.user.fullName || "" }, { onSuccess: () => toast.success("Receipt confirmed."), onError: () => toast.error("Could not confirm.") }) },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={colors.brand[600]} />}>
        <ScreenHeader title="My assets" />
        {query.isLoading ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState message={(query.error as Error).message} onRetry={query.refetch} />
        ) : !query.data?.length ? (
          <EmptyState icon="laptop-outline" title="Nothing assigned to you" body="When IT or admin hands you equipment, it is listed here with when it is due back." />
        ) : (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {query.data.map((a, index) => (
              <View key={a.id}>
                {index > 0 && <Divider />}
                <View style={{ paddingVertical: spacing.md }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Txt variant="bodyMedium" style={{ flex: 1 }} numberOfLines={1}>
                      {a.asset?.name}
                    </Txt>
                    {a.isOverdue ? <Badge label="Return overdue" tone="danger" /> : a.acknowledgedAt ? <Badge label="Confirmed" tone="success" /> : <Badge label="Confirm receipt" tone="warning" />}
                  </View>
                  <Txt variant="caption" tone="muted" style={{ marginTop: 3 }}>
                    {a.asset?.tag} · {humanise(a.asset?.category)}
                    {a.asset?.serialNumber ? ` · S/N ${a.asset.serialNumber}` : ""} · since {format(new Date(a.assignedOn), "d MMM yyyy")}
                    {a.expectedReturnOn ? ` · due ${format(new Date(a.expectedReturnOn), "d MMM yyyy")}` : ""}
                  </Txt>
                  {!a.acknowledgedAt && (
                    <View style={{ marginTop: spacing.sm, alignSelf: "flex-start" }}>
                      <Button title="I have it" size="sm" onPress={() => confirm(a.id, `${a.asset?.name} (${a.asset?.tag})`)} loading={acknowledge.isPending} />
                    </View>
                  )}
                </View>
              </View>
            ))}
          </Card>
        )}
      </Screen>
    </SafeAreaView>
  );
}
