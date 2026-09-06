import { useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLoan, useLoanLimits, useLoanPreview, useMyLoans, useRequestLoan } from "../../src/api/hooks";
import { ApiError } from "../../src/api/client";
import { useSession } from "../../src/auth/session";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, Divider, EmptyState, ErrorState, Field, Loading, Screen, Txt } from "../../src/components/ui";
import { Chips, ScreenHeader } from "../../src/components/ScreenHeader";
import { Note, Sheet } from "../../src/components/Sheet";
import { spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";
import { dateLabel, humanise, money, periodLabel, upcomingPeriods } from "../../src/lib/format";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { requested: "warning", approved: "info", active: "info", closed: "success", rejected: "danger", cancelled: "neutral" };

/** Loans and salary advances — the web portal's /me/loans, schedule included. */
export default function Loans() {
  const colors = useColors();
  const toast = useToast();
  const { session } = useSession();
  const currency = session?.organization?.currency || "INR";
  const list = useMyLoans();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const canAsk = !session || session.permissions.includes("loan.view_own");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={list.refetch} tintColor={colors.brand[600]} />}>
        <ScreenHeader title="Loans and advances" action={canAsk ? <Button title="Ask" size="sm" icon="add" onPress={() => setCreating(true)} /> : undefined} />
        <Txt variant="caption" tone="muted" style={{ marginBottom: spacing.lg, lineHeight: 18 }}>
          Ask for a loan or a salary advance; repayments are deducted from your salary automatically.
        </Txt>

        {list.isLoading ? (
          <Loading />
        ) : list.isError ? (
          <ErrorState message={(list.error as Error).message} onRetry={list.refetch} />
        ) : !list.data?.length ? (
          <Card>
            <EmptyState icon="cash-outline" title="No loans" body="Request a loan or an advance. You see the repayment schedule before you send it, and every deduction on your payslip." action={canAsk ? <Button title="Ask for a loan" onPress={() => setCreating(true)} /> : undefined} />
          </Card>
        ) : (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {list.data.map((loan, index) => (
              <View key={loan.id}>
                {index > 0 && <Divider />}
                <Pressable onPress={() => setOpenId(loan.id)} style={{ paddingVertical: spacing.md }} accessibilityRole="button">
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Txt variant="caption" tone="subtle">
                      #{loan.number}
                    </Txt>
                    <Txt variant="bodyMedium" style={{ flex: 1 }}>
                      {loan.type === "advance" ? "Salary advance" : "Loan"} of {money(loan.principal, currency)}
                    </Txt>
                    <Badge label={humanise(loan.status)} tone={STATUS_TONE[loan.status] ?? "neutral"} />
                  </View>
                  <Txt variant="caption" tone="muted" style={{ marginTop: 3 }}>
                    {loan.instalments} × {money(loan.instalmentAmount, currency)} from {periodLabel(loan.startPeriod)}
                    {loan.interestRatePercent ? ` · ${loan.interestRatePercent}% p.a.` : " · interest-free"}
                    {loan.purpose ? ` · ${loan.purpose}` : ""}
                  </Txt>
                  {loan.status === "active" && (
                    <Txt variant="caption" style={{ marginTop: 3 }}>
                      {money(loan.outstanding, currency)} outstanding · {loan.instalmentsRemaining} left
                    </Txt>
                  )}
                  {loan.decisionComment ? (
                    <Txt variant="caption" tone="muted" style={{ marginTop: 3, fontStyle: "italic" }}>
                      “{loan.decisionComment}”
                    </Txt>
                  ) : null}
                </Pressable>
              </View>
            ))}
          </Card>
        )}
      </Screen>

      {creating && <RequestSheet currency={currency} onClose={() => setCreating(false)} />}
      {openId && <LoanDetailSheet id={openId} currency={currency} onClose={() => setOpenId(null)} />}
    </SafeAreaView>
  );
}

function RequestSheet({ currency, onClose }: { currency: string; onClose: () => void }) {
  const toast = useToast();
  const request = useRequestLoan();
  const limits = useLoanLimits();
  const [type, setType] = useState<"loan" | "advance">("loan");
  const [principal, setPrincipal] = useState("");
  const [instalments, setInstalments] = useState("6");
  const [startPeriod, setStartPeriod] = useState("");
  const [purpose, setPurpose] = useState("");
  const preview = useLoanPreview(Number(principal) || 0, Number(instalments) || 0, startPeriod || undefined);

  const send = async () => {
    try {
      await request.mutateAsync({ type, principal: Number(principal), instalments: Number(instalments), purpose, startPeriod: startPeriod || undefined });
      toast.success("Request sent. You will be told when it is decided.");
      onClose();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not send the request.");
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Ask for a loan or advance"
      tall
      footer={
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button title="Cancel" variant="secondary" onPress={onClose} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Send request" onPress={send} loading={request.isPending} disabled={!Number(principal) || !Number(instalments)} />
          </View>
        </View>
      }
    >
      <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>
        Kind
      </Txt>
      <Chips
        options={[
          { value: "loan", label: "Loan" },
          { value: "advance", label: "Salary advance" },
        ]}
        value={type}
        onChange={setType}
      />
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Field label="Amount" keyboardType="number-pad" value={principal} onChangeText={setPrincipal} hint={limits.data?.maxAmount ? `Up to ${money(limits.data.maxAmount, currency)}` : undefined} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Instalments" keyboardType="number-pad" value={instalments} onChangeText={setInstalments} hint={limits.data ? `Up to ${limits.data.maxInstalments}` : undefined} />
        </View>
      </View>
      <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>
        First deduction from
      </Txt>
      <Chips options={[{ value: "", label: "Next month" }, ...upcomingPeriods(5).slice(1)]} value={startPeriod} onChange={setStartPeriod} />
      <Field label="Purpose" placeholder="e.g. Medical expenses, house deposit" value={purpose} onChangeText={setPurpose} multiline numberOfLines={2} style={{ minHeight: 56, textAlignVertical: "top" }} />
      {preview.data && preview.data.rows.length > 0 && (
        <Note tone="info">
          {preview.data.rows.length} deductions of about {money(preview.data.instalmentAmount, currency)}, {periodLabel(preview.data.rows[0].periodKey)} to {periodLabel(preview.data.rows[preview.data.rows.length - 1].periodKey)} · total {money(preview.data.totalRepayable, currency)}
          {preview.data.interest ? ` including ${money(preview.data.interest, currency)} interest` : ""}.
        </Note>
      )}
    </Sheet>
  );
}

function LoanDetailSheet({ id, currency, onClose }: { id: string; currency: string; onClose: () => void }) {
  const colors = useColors();
  const query = useLoan(id);
  const loan = query.data;
  return (
    <Sheet open onClose={onClose} title={loan ? `#${loan.number} ${loan.type === "advance" ? "Salary advance" : "Loan"}` : "Loan"} tall>
      {!loan ? (
        <Loading />
      ) : (
        <View style={{ paddingBottom: spacing.lg }}>
          <Txt variant="body">
            {money(loan.principal, currency)} · {humanise(loan.status)}
            {loan.decisionComment ? ` · “${loan.decisionComment}”` : ""}
          </Txt>
          {loan.disbursedOn && (
            <Txt variant="caption" tone="muted" style={{ marginTop: 4 }}>
              Paid out {dateLabel(loan.disbursedOn)} by {humanise(loan.disbursedVia || "")}.
            </Txt>
          )}
          {loan.status === "active" && (
            <Txt variant="body" style={{ marginTop: spacing.sm }}>
              Outstanding <Txt variant="bodyMedium">{money(loan.outstanding, currency)}</Txt> · {loan.instalmentsRemaining} instalment{loan.instalmentsRemaining === 1 ? "" : "s"} left
            </Txt>
          )}
          <Txt variant="caption" tone="subtle" style={{ textTransform: "uppercase", letterSpacing: 0.6, marginTop: spacing.lg, marginBottom: spacing.sm }}>
            Repayment schedule
          </Txt>
          {!loan.schedule?.length ? (
            <Txt variant="caption" tone="muted">
              The schedule is created when the loan is disbursed.
            </Txt>
          ) : (
            loan.schedule.map((s) => (
              <View key={s.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Txt variant="body" style={{ flex: 1 }}>
                  {periodLabel(s.periodKey)}
                </Txt>
                <Txt variant="body" style={{ marginRight: spacing.md }}>
                  {money(s.amount, currency)}
                </Txt>
                <Badge label={s.status === "applied" ? "Deducted" : humanise(s.status)} tone={s.status === "applied" ? "success" : s.status === "cancelled" ? "neutral" : "info"} />
              </View>
            ))
          )}
        </View>
      )}
    </Sheet>
  );
}
