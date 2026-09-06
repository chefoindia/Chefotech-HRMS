import { useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { usePayslip, usePayslips, type Payslip } from "../../src/api/hooks";
import { ApiError } from "../../src/api/client";
import { useSession } from "../../src/auth/session";
import { useColors } from "../../src/theme/ThemeProvider";
import { Button, Card, EmptyState, ErrorState, Loading, Screen, Txt } from "../../src/components/ui";
import { Sheet } from "../../src/components/Sheet";
import { radius, spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";
import { openFile } from "../../src/lib/files";
import { dateLabel, money } from "../../src/lib/format";

/**
 * Payslips — the web portal's /me/payslips: every published payslip, the
 * working behind each figure, and the PDF to share with a bank.
 */
export default function Payslips() {
  const colors = useColors();
  const toast = useToast();
  const { session } = useSession();
  const currency = session?.organization?.currency || "INR";
  const query = usePayslips();
  const [viewing, setViewing] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const allowed = !session || session.permissions.includes("payroll.view_own_payslip");

  const download = async (payslip: Payslip) => {
    setDownloading(payslip.id);
    try {
      await openFile(`/payroll/payslips/${payslip.id}/pdf`, `payslip-${payslip.periodLabel.replace(/\W+/g, "-")}.pdf`, "application/pdf");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not download that payslip. Please try again.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={colors.brand[600]} />}>
        <Txt variant="title" style={{ marginBottom: spacing.lg }}>
          My payslips
        </Txt>

        {!allowed ? (
          <Card>
            <EmptyState icon="lock-closed-outline" title="Payslips are not available to you" body="Ask HR if you think you should be seeing them." />
          </Card>
        ) : query.isLoading ? (
          <Loading label="Loading your payslips…" />
        ) : query.isError ? (
          <ErrorState message={query.error instanceof ApiError ? query.error.message : "Could not load your payslips."} onRetry={query.refetch} />
        ) : (query.data ?? []).length === 0 ? (
          <Card>
            <EmptyState icon="wallet-outline" title="No payslips yet" body="They appear here as soon as payroll publishes them." />
          </Card>
        ) : (
          <View style={{ gap: spacing.md }}>
            {(query.data ?? []).map((payslip) => (
              <Card key={payslip.id}>
                <Pressable onPress={() => setViewing(payslip.id)} accessibilityRole="button">
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.brand[50], alignItems: "center", justifyContent: "center", marginRight: spacing.md }}>
                      <Ionicons name="document-text-outline" size={20} color={colors.brand[600]} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt variant="bodyMedium" numberOfLines={1}>
                        {payslip.periodLabel}
                      </Txt>
                      <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
                        {payslip.payslipNumber}
                        {payslip.publishedAt ? ` · published ${dateLabel(payslip.publishedAt)}` : ""}
                      </Txt>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Txt variant="bodyMedium">{money(payslip.net, currency, 2)}</Txt>
                      <Txt variant="caption" tone="subtle">
                        net pay
                      </Txt>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", marginTop: spacing.md }}>
                    <View style={{ flex: 1 }}>
                      <Txt variant="caption" tone="subtle">
                        GROSS
                      </Txt>
                      <Txt variant="label">{money(payslip.gross, currency, 2)}</Txt>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Txt variant="caption" tone="subtle">
                        DEDUCTIONS
                      </Txt>
                      <Txt variant="label">{money(payslip.totalDeductions, currency, 2)}</Txt>
                    </View>
                  </View>
                </Pressable>
                <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <Button title="View" variant="secondary" size="sm" icon="eye-outline" onPress={() => setViewing(payslip.id)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button title={downloading === payslip.id ? "Preparing…" : "Download PDF"} variant="secondary" size="sm" icon="download-outline" onPress={() => download(payslip)} loading={downloading === payslip.id} />
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}
      </Screen>

      {viewing && <PayslipSheet id={viewing} currency={currency} onClose={() => setViewing(null)} />}
    </SafeAreaView>
  );
}

function PayslipSheet({ id, currency, onClose }: { id: string; currency: string; onClose: () => void }) {
  const colors = useColors();
  const query = usePayslip(id);
  const payslip = query.data;
  const [showBreakdown, setShowBreakdown] = useState(false);
  const lines = payslip?.snapshot?.lines || [];
  const earnings = lines.filter((l) => l.type === "earning" && l.showOnPayslip);
  const deductions = lines.filter((l) => l.type === "deduction" && l.showOnPayslip);

  return (
    <Sheet open onClose={onClose} title={payslip ? `Payslip · ${payslip.periodLabel}` : "Payslip"} subtitle={payslip?.payslipNumber} tall>
      {!payslip ? (
        <Loading />
      ) : (
        <View style={{ paddingBottom: spacing.lg }}>
          {payslip.snapshot?.attendance && (
            <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg }}>
              <Metric label="Days" value={payslip.snapshot.attendance.totalDays} />
              <Metric label="Payable" value={payslip.snapshot.attendance.payableDays} />
              <Metric label="Loss of pay" value={payslip.snapshot.attendance.lossOfPayDays} />
              <Metric label="Paid leave" value={payslip.snapshot.attendance.paidLeaveDays} />
            </View>
          )}
          <Section title="Earnings" lines={earnings} currency={currency} />
          <Section title="Deductions" lines={deductions} currency={currency} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: colors.brand[200], backgroundColor: colors.brand[50], borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md }}>
            <Txt variant="bodyMedium" style={{ color: colors.brand[700] }}>
              Net payable
            </Txt>
            <Txt variant="heading" style={{ color: colors.brand[700] }}>
              {money(payslip.net, currency, 2)}
            </Txt>
          </View>
          {payslip.snapshot?.breakdown && payslip.snapshot.breakdown.length > 0 && (
            <View style={{ marginTop: spacing.lg }}>
              <Pressable onPress={() => setShowBreakdown(!showBreakdown)} style={{ flexDirection: "row", alignItems: "center" }}>
                <Txt variant="label" tone="muted" style={{ flex: 1 }}>
                  How this was calculated
                </Txt>
                <Ionicons name={showBreakdown ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
              </Pressable>
              {showBreakdown &&
                payslip.snapshot.breakdown.map((entry, index) => (
                  <View key={index} style={{ flexDirection: "row", gap: spacing.sm, marginTop: 6 }}>
                    <Txt variant="caption" tone="muted" style={{ flex: 1, lineHeight: 18 }}>
                      {entry.detail}
                    </Txt>
                    <Txt variant="caption" style={{ lineHeight: 18 }}>
                      {entry.effect}
                    </Txt>
                  </View>
                ))}
            </View>
          )}
        </View>
      )}
    </Sheet>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: "center" }}>
      <Txt variant="caption" tone="subtle" style={{ fontSize: 10, textTransform: "uppercase" }}>
        {label}
      </Txt>
      <Txt variant="bodyMedium" style={{ marginTop: 2 }}>
        {value}
      </Txt>
    </View>
  );
}

function Section({ title, lines, currency }: { title: string; lines: { code: string; name: string; amount: number }[]; currency: string }) {
  const colors = useColors();
  if (!lines.length) return null;
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Txt variant="caption" tone="subtle" style={{ textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>
        {title}
      </Txt>
      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
        {lines.map((line, index) => (
          <View key={line.code} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: 8, borderTopWidth: index ? 1 : 0, borderTopColor: colors.border }}>
            <Txt variant="body" style={{ flex: 1 }}>
              {line.name}
            </Txt>
            <Txt variant="bodyMedium">{money(line.amount, currency, 2)}</Txt>
          </View>
        ))}
      </View>
    </View>
  );
}
