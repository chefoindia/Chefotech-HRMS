import { useState } from "react";
import { RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLoanPreview, useMyLoans, useRequestLoan } from "../../src/api/hooks";
import { ApiError } from "../../src/api/client";
import { useSession } from "../../src/auth/session";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, Divider, EmptyState, ErrorState, Field, Loading, Screen, Txt } from "../../src/components/ui";
import { Chips, ScreenHeader, humanise } from "../../src/components/ScreenHeader";
import { spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { requested: "warning", approved: "info", active: "info", closed: "success", rejected: "danger", cancelled: "neutral" };

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return String(amount);
  }
}

function periodLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** Loans and salary advances, recovered from salary. */
export default function Loans() {
  const colors = useColors();
  const toast = useToast();
  const { session } = useSession();
  const currency = (session?.organization as { currency?: string } | null)?.currency || "INR";
  const list = useMyLoans();
  const request = useRequestLoan();
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState<"loan" | "advance">("loan");
  const [principal, setPrincipal] = useState("");
  const [instalments, setInstalments] = useState("6");
  const [purpose, setPurpose] = useState("");
  const [error, setError] = useState<string | null>(null);
  const preview = useLoanPreview(Number(principal) || 0, Number(instalments) || 0);

  const send = async () => {
    setError(null);
    try {
      await request.mutateAsync({ type, principal: Number(principal), instalments: Number(instalments), purpose });
      toast.success("Request sent.");
      setCreating(false);
      setPrincipal("");
      setPurpose("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not send the request.");
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={list.refetch} tintColor={colors.brand[600]} />}>
        <ScreenHeader title="Loans" action={!creating ? <Button title="Ask" size="sm" icon="add" onPress={() => setCreating(true)} /> : undefined} />

        {creating && (
          <Card style={{ marginBottom: spacing.lg }}>
            <Chips options={[{ value: "loan", label: "Loan" }, { value: "advance", label: "Salary advance" }]} value={type} onChange={setType} />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}><Field label="Amount" keyboardType="number-pad" value={principal} onChangeText={setPrincipal} /></View>
              <View style={{ flex: 1 }}><Field label="Instalments" keyboardType="number-pad" value={instalments} onChangeText={setInstalments} /></View>
            </View>
            <Field label="Purpose" placeholder="e.g. Medical expenses" value={purpose} onChangeText={setPurpose} />
            {preview.data && (
              <Txt variant="caption" tone="muted" style={{ marginBottom: spacing.md, lineHeight: 18 }}>
                {preview.data.rows.length} deductions of about {money(preview.data.instalmentAmount, currency)}, {periodLabel(preview.data.rows[0].periodKey)} to {periodLabel(preview.data.rows[preview.data.rows.length - 1].periodKey)}.
              </Txt>
            )}
            {error && <Txt variant="caption" tone="danger" style={{ marginBottom: spacing.md }}>{error}</Txt>}
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}><Button title="Cancel" variant="secondary" onPress={() => setCreating(false)} /></View>
              <View style={{ flex: 1 }}><Button title="Send request" onPress={send} loading={request.isPending} disabled={!Number(principal) || !Number(instalments)} /></View>
            </View>
          </Card>
        )}

        {list.isLoading ? (
          <Loading />
        ) : list.isError ? (
          <ErrorState message={(list.error as Error).message} onRetry={list.refetch} />
        ) : !list.data?.length ? (
          <EmptyState icon="cash-outline" title="No loans" body="Ask for a loan or an advance. You see the repayment schedule before sending, and every deduction on your payslip." />
        ) : (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {list.data.map((loan, index) => (
              <View key={loan.id}>
                {index > 0 && <Divider />}
                <View style={{ paddingVertical: spacing.md }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Txt variant="bodyMedium" style={{ flex: 1 }}>
                      {loan.type === "advance" ? "Advance" : "Loan"} of {money(loan.principal, currency)}
                    </Txt>
                    <Badge label={humanise(loan.status)} tone={STATUS_TONE[loan.status] ?? "neutral"} />
                  </View>
                  <Txt variant="caption" tone="muted" style={{ marginTop: 3 }}>
                    #{loan.number} · {loan.instalments} × {money(loan.instalmentAmount, currency)} from {periodLabel(loan.startPeriod)}
                    {loan.status === "active" ? ` · ${money(loan.outstanding, currency)} outstanding` : ""}
                  </Txt>
                  {loan.decisionComment ? <Txt variant="caption" tone="muted" style={{ marginTop: 3, fontStyle: "italic" }}>“{loan.decisionComment}”</Txt> : null}
                </View>
              </View>
            ))}
          </Card>
        )}
      </Screen>
    </SafeAreaView>
  );
}
