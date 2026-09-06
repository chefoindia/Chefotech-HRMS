import { useState } from "react";
import { Alert, Pressable, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { format } from "date-fns";
import { useCreateExpense, useExpensePolicy, useMyExpenses, useWithdrawExpense } from "../../src/api/hooks";
import { ApiError } from "../../src/api/client";
import { useSession } from "../../src/auth/session";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, Divider, EmptyState, ErrorState, Field, Loading, Screen, Txt } from "../../src/components/ui";
import { Chips, ScreenHeader, humanise } from "../../src/components/ScreenHeader";
import { spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { draft: "neutral", submitted: "warning", approved: "info", rejected: "danger", reimbursed: "success", cancelled: "neutral" };

interface Line {
  date: string;
  category: string;
  description: string;
  amount: string;
}

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return String(amount);
  }
}

/** Expense claims from the phone. Receipts are attached on the web. */
export default function Expenses() {
  const colors = useColors();
  const toast = useToast();
  const { session } = useSession();
  const currency = (session?.organization as { currency?: string } | null)?.currency || "INR";
  const list = useMyExpenses();
  const policy = useExpensePolicy();
  const create = useCreateExpense();
  const withdraw = useWithdrawExpense();

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<Line[]>([{ date: format(new Date(), "yyyy-MM-dd"), category: "", description: "", amount: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const send = async (submit: boolean) => {
    setError(null);
    try {
      await create.mutateAsync({ title, lines: lines.map((l) => ({ date: l.date, category: l.category, description: l.description, amount: Number(l.amount) || 0 })), submit });
      toast.success(submit ? "Claim submitted." : "Draft saved.");
      setCreating(false);
      setTitle("");
      setLines([{ date: format(new Date(), "yyyy-MM-dd"), category: "", description: "", amount: "" }]);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the claim.");
    }
  };

  const categories = (policy.data?.categories || []).map((c) => ({ value: c, label: humanise(c) }));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={list.refetch} tintColor={colors.brand[600]} />}>
        <ScreenHeader title="My expenses" action={!creating ? <Button title="New" size="sm" icon="add" onPress={() => setCreating(true)} /> : undefined} />

        {creating && (
          <Card style={{ marginBottom: spacing.lg }}>
            <Field label="Title" placeholder="e.g. Client visit, Pune" value={title} onChangeText={setTitle} />
            {lines.map((line, i) => (
              <View key={i} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: colors.border, paddingTop: i ? spacing.md : 0, marginBottom: spacing.sm }}>
                <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>Category</Txt>
                <Chips options={categories} value={line.category} onChange={(v) => setLine(i, { category: v })} />
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}><Field label="Date" value={line.date} onChangeText={(v) => setLine(i, { date: v })} autoCapitalize="none" /></View>
                  <View style={{ flex: 1 }}><Field label="Amount" keyboardType="decimal-pad" value={line.amount} onChangeText={(v) => setLine(i, { amount: v })} /></View>
                </View>
                <Field label="Description" placeholder="Optional" value={line.description} onChangeText={(v) => setLine(i, { description: v })} />
                {lines.length > 1 && <Button title="Remove line" variant="ghost" size="sm" onPress={() => setLines(lines.filter((_, idx) => idx !== i))} />}
              </View>
            ))}
            <Button title="Add another line" variant="secondary" size="sm" icon="add" onPress={() => setLines([...lines, { date: format(new Date(), "yyyy-MM-dd"), category: "", description: "", amount: "" }])} />
            <Txt variant="bodyMedium" style={{ marginTop: spacing.md }}>Total {money(total, currency)}</Txt>
            <Txt variant="caption" tone="subtle" style={{ marginTop: 4 }}>Receipts can be attached from the web portal before approval.</Txt>
            {error && <Txt variant="caption" tone="danger" style={{ marginTop: spacing.md }}>{error}</Txt>}
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
              <View style={{ flex: 1 }}><Button title="Cancel" variant="secondary" onPress={() => setCreating(false)} /></View>
              <View style={{ flex: 1 }}><Button title="Submit" onPress={() => send(true)} loading={create.isPending} disabled={!title.trim() || lines.some((l) => !l.category || !Number(l.amount))} /></View>
            </View>
          </Card>
        )}

        {list.isLoading ? (
          <Loading />
        ) : list.isError ? (
          <ErrorState message={(list.error as Error).message} onRetry={list.refetch} />
        ) : !list.data?.length ? (
          <EmptyState icon="receipt-outline" title="No claims yet" body="Claim what you spent for work. Your manager approves, finance pays it with your salary or by transfer." />
        ) : (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {list.data.map((claim, index) => (
              <View key={claim.id}>
                {index > 0 && <Divider />}
                <Pressable onPress={() => setExpanded(expanded === claim.id ? null : claim.id)} style={{ paddingVertical: spacing.md }} accessibilityRole="button">
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Txt variant="bodyMedium" style={{ flex: 1 }} numberOfLines={1}>{claim.title}</Txt>
                    <Txt variant="bodyMedium">{money(claim.approvedTotal ?? claim.total, currency)}</Txt>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4 }}>
                    <Txt variant="caption" tone="muted" style={{ flex: 1 }}>
                      #{claim.number} · {claim.lines.length} line{claim.lines.length === 1 ? "" : "s"} · {format(new Date(claim.submittedAt || claim.createdAt), "d MMM")}
                      {claim.reimbursement ? ` · ${claim.reimbursement.viaPayroll ? "paid with salary" : "paid"}` : ""}
                    </Txt>
                    <Badge label={claim.status === "submitted" ? "Awaiting approval" : humanise(claim.status)} tone={STATUS_TONE[claim.status] ?? "neutral"} />
                  </View>
                  {claim.decisionComment ? <Txt variant="caption" tone="muted" style={{ marginTop: 3, fontStyle: "italic" }}>“{claim.decisionComment}”</Txt> : null}
                  {expanded === claim.id && (
                    <View style={{ marginTop: spacing.sm }}>
                      {claim.lines.map((l, i) => (
                        <Txt key={l.id || i} variant="caption" tone="muted">
                          {l.date} · {humanise(l.category)}{l.description ? ` · ${l.description}` : ""} · {money(l.amount, currency)}
                        </Txt>
                      ))}
                      {claim.status === "submitted" && (
                        <View style={{ marginTop: spacing.sm, alignSelf: "flex-start" }}>
                          <Button title="Withdraw" variant="ghost" size="sm" onPress={() => Alert.alert("Withdraw this claim?", "It goes back to a draft.", [{ text: "Keep", style: "cancel" }, { text: "Withdraw", style: "destructive", onPress: () => withdraw.mutate(claim.id) }])} />
                        </View>
                      )}
                    </View>
                  )}
                </Pressable>
              </View>
            ))}
          </Card>
        )}
      </Screen>
    </SafeAreaView>
  );
}
