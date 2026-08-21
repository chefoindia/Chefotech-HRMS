import { useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { format } from "date-fns";
import { usePayslips, type Payslip } from "../../src/api/hooks";
import { api, tokens, ApiError } from "../../src/api/client";
import { useColors } from "../../src/theme/ThemeProvider";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Screen,
  Txt,
} from "../../src/components/ui";
import { radius, spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";

/**
 * Payslips.
 *
 * Only published ones reach this list — the API already filters drafts, and a
 * phone showing an unapproved figure to an employee before payroll has signed
 * it off would be worse than showing nothing.
 *
 * Download goes through the share sheet rather than writing to the Downloads
 * folder. It is the one path that works identically on both platforms, and it
 * lets the person put the PDF wherever they actually need it — usually into a
 * bank's loan application.
 */
export default function Payslips() {
  const colors = useColors();
  const toast = useToast();
  const query = usePayslips();
  const [downloading, setDownloading] = useState<string | null>(null);

  const download = async (payslip: Payslip) => {
    setDownloading(payslip.id);
    try {
      const url = await api.fileUrl(`/payroll/payslips/${payslip.id}/pdf`);
      const { access } = await tokens.get();

      const label = payslip.period.label ?? `${payslip.period.year}-${payslip.period.month}`;
      const target = new File(Paths.cache, `payslip-${label.replace(/\W+/g, "-")}.pdf`);

      // The cache is shared across launches, so a payslip downloaded before
      // must be replaced rather than throwing "already exists".
      const file = await File.downloadFileAsync(url, target, {
        headers: access ? { Authorization: `Bearer ${access}` } : undefined,
        idempotent: true,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "application/pdf",
          UTI: "com.adobe.pdf",
          dialogTitle: `Payslip · ${label}`,
        });
      } else {
        toast.success("Payslip downloaded.");
      }
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Could not download that payslip. Please try again."
      );
    } finally {
      setDownloading(null);
    }
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
        <Txt variant="title" style={{ marginBottom: spacing.lg }}>
          Payslips
        </Txt>

        {query.isLoading ? (
          <Loading label="Loading your payslips…" />
        ) : query.isError ? (
          <ErrorState
            message={
              query.error instanceof ApiError ? query.error.message : "Could not load your payslips."
            }
            onRetry={query.refetch}
          />
        ) : (query.data ?? []).length === 0 ? (
          <Card>
            <EmptyState
              icon="wallet-outline"
              title="No payslips yet"
              body="Payslips appear here once your employer publishes them for a pay period."
            />
          </Card>
        ) : (
          <View style={{ gap: spacing.md }}>
            {(query.data ?? []).map((payslip) => (
              <Card key={payslip.id}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: radius.md,
                      backgroundColor: colors.brand[50],
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: spacing.md,
                    }}
                  >
                    <Ionicons name="document-text-outline" size={20} color={colors.brand[600]} />
                  </View>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt variant="bodyMedium" numberOfLines={1}>
                      {payslip.period.label ??
                        format(
                          new Date(payslip.period.year, payslip.period.month - 1),
                          "MMMM yyyy"
                        )}
                    </Txt>
                    {payslip.publishedAt && (
                      <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
                        Published {format(new Date(payslip.publishedAt), "d MMM yyyy")}
                      </Txt>
                    )}
                  </View>

                  <View style={{ alignItems: "flex-end" }}>
                    <Txt variant="bodyMedium">
                      {payslip.currency ?? "₹"}
                      {Number(payslip.netPay ?? 0).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </Txt>
                    <Txt variant="caption" tone="subtle">
                      net pay
                    </Txt>
                  </View>
                </View>

                <Pressable
                  onPress={() => download(payslip)}
                  disabled={downloading === payslip.id}
                  accessibilityRole="button"
                  accessibilityLabel="Download payslip"
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: spacing.md,
                    paddingVertical: spacing.md,
                    borderRadius: radius.sm,
                    backgroundColor: colors.surfaceSunken,
                    opacity: pressed || downloading === payslip.id ? 0.6 : 1,
                  })}
                >
                  <Ionicons
                    name={downloading === payslip.id ? "hourglass-outline" : "download-outline"}
                    size={16}
                    color={colors.brand[600]}
                  />
                  <Txt variant="label" tone="brand" style={{ marginLeft: 6 }}>
                    {downloading === payslip.id ? "Preparing…" : "Download PDF"}
                  </Txt>
                </Pressable>
              </Card>
            ))}
          </View>
        )}
      </Screen>
    </SafeAreaView>
  );
}
