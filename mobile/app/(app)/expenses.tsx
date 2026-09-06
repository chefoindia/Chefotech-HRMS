import { useState } from "react";
import { Alert, Pressable, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useExpensePolicy, useMyExpenses, useSaveExpense, useUploadReceipt, useWithdrawExpense, type ExpenseItem, type ExpenseLine } from "../../src/api/hooks";
import { ApiError } from "../../src/api/client";
import { useSession } from "../../src/auth/session";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, Divider, EmptyState, ErrorState, Field, Loading, Screen, Txt } from "../../src/components/ui";
import { ScreenHeader, Chips } from "../../src/components/ScreenHeader";
import { Note, Sheet, Stat, TabStrip } from "../../src/components/Sheet";
import { DatePickerSheet } from "../../src/components/DatePickerSheet";
import { radius, spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";
import { openFile, pickPhoto } from "../../src/lib/files";
import { dateLabel, humanise, money, relative, todayString } from "../../src/lib/format";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { draft: "neutral", submitted: "warning", approved: "info", rejected: "danger", reimbursed: "success", cancelled: "neutral" };
const ACTIVE = ["draft", "submitted", "approved"];

/** My expense claims — the web portal's /me/expenses, receipts included. */
export default function Expenses() {
  const colors = useColors();
  const toast = useToast();
  const { session } = useSession();
  const currency = session?.organization?.currency || "INR";
  const list = useMyExpenses();
  const withdraw = useWithdrawExpense();
  const [tab, setTab] = useState<"active" | "settled">("active");
  const [editing, setEditing] = useState<ExpenseItem | "new" | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const canSubmit = !session || session.permissions.includes("expense.submit");

  const rows = list.data || [];
  const active = rows.filter((c) => ACTIVE.includes(c.status));
  const settled = rows.filter((c) => !ACTIVE.includes(c.status));
  const shown = tab === "active" ? active : settled;
  const awaiting = rows.filter((c) => c.status === "submitted").reduce((s, c) => s + c.total, 0);
  const approvedUnpaid = rows.filter((c) => c.status === "approved").reduce((s, c) => s + c.payable, 0);
  const paidThisYear = rows.filter((c) => c.status === "reimbursed" && new Date(c.createdAt).getFullYear() === new Date().getFullYear()).reduce((s, c) => s + c.payable, 0);

  const confirmWithdraw = (claim: ExpenseItem) =>
    Alert.alert("Withdraw this claim?", "It goes back to a draft you can edit and resubmit.", [
      { text: "Keep", style: "cancel" },
      { text: "Withdraw", style: "destructive", onPress: () => withdraw.mutateAsync(claim.id).then(() => toast.success("Claim withdrawn. It is back in your drafts.")).catch((e) => toast.error(e instanceof ApiError ? e.message : "Could not withdraw that claim.")) },
    ]);

  const viewReceipt = async (fileId: string) => {
    try {
      await openFile(`/files/${fileId}/content`, "receipt");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not open that receipt.");
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={list.refetch} tintColor={colors.brand[600]} />}>
        <ScreenHeader title="My expenses" action={canSubmit ? <Button title="New claim" size="sm" icon="add" onPress={() => setEditing("new")} /> : undefined} />

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg }}>
          <Stat label="Awaiting approval" value={money(awaiting, currency)} />
          <Stat label="Approved, not yet paid" value={money(approvedUnpaid, currency)} />
          <Stat label="Reimbursed this year" value={money(paidThisYear, currency)} />
        </View>

        <TabStrip
          items={[
            { key: "active", label: "In progress", count: active.length },
            { key: "settled", label: "Settled", count: settled.length },
          ]}
          active={tab}
          onChange={setTab}
        />

        {list.isLoading ? (
          <Loading />
        ) : list.isError ? (
          <ErrorState message={(list.error as Error).message} onRetry={list.refetch} />
        ) : !shown.length ? (
          <Card>
            <EmptyState icon="receipt-outline" title={tab === "active" ? "No claims in progress" : "Nothing settled yet"} body="Add the lines, attach receipts and submit. Your manager approves, finance pays." action={canSubmit ? <Button title="New claim" onPress={() => setEditing("new")} /> : undefined} />
          </Card>
        ) : (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {shown.map((claim, index) => (
              <View key={claim.id}>
                {index > 0 && <Divider />}
                <Pressable onPress={() => setExpanded(expanded === claim.id ? null : claim.id)} style={{ paddingVertical: spacing.md }} accessibilityRole="button">
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Txt variant="caption" tone="subtle">
                      #{claim.number}
                    </Txt>
                    <Txt variant="bodyMedium" style={{ flex: 1 }} numberOfLines={1}>
                      {claim.title}
                    </Txt>
                    <View style={{ alignItems: "flex-end" }}>
                      <Txt variant="bodyMedium">{money(claim.approvedTotal ?? claim.total, currency)}</Txt>
                      {claim.approvedTotal !== null && claim.approvedTotal !== claim.total && (
                        <Txt variant="caption" tone="subtle">
                          of {money(claim.total, currency)} claimed
                        </Txt>
                      )}
                      {claim.advanceAmount > 0 && (
                        <Txt variant="caption" tone="subtle">
                          less advance {money(claim.advanceAmount, currency)}
                        </Txt>
                      )}
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4 }}>
                    <Txt variant="caption" tone="muted" style={{ flex: 1 }}>
                      {claim.lines.length} line{claim.lines.length === 1 ? "" : "s"} · {claim.submittedAt ? `submitted ${relative(claim.submittedAt)}` : `created ${relative(claim.createdAt)}`}
                      {claim.decidedAt ? ` · ${claim.status === "rejected" ? "rejected" : "approved"} ${relative(claim.decidedAt)}${claim.decidedBy ? ` by ${claim.decidedBy}` : ""}` : ""}
                      {claim.reimbursement ? ` · ${claim.reimbursement.viaPayroll ? "paid with salary" : `paid by ${humanise(claim.reimbursement.method)}${claim.reimbursement.reference ? ` (${claim.reimbursement.reference})` : ""}`}` : ""}
                    </Txt>
                    {claim.viaWorkflow && claim.status === "submitted" && <Badge label="In workflow" tone="info" />}
                    <Badge label={claim.status === "submitted" ? "Awaiting approval" : humanise(claim.status)} tone={STATUS_TONE[claim.status] ?? "neutral"} />
                  </View>
                  {claim.decisionComment ? (
                    <Txt variant="caption" tone="muted" style={{ marginTop: 3, fontStyle: "italic" }}>
                      “{claim.decisionComment}”
                    </Txt>
                  ) : null}
                  {expanded === claim.id && (
                    <View style={{ marginTop: spacing.sm }}>
                      {claim.lines.map((l, i) => (
                        <View key={l.id || i} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 4 }}>
                          <Txt variant="caption" tone="muted" style={{ flex: 1 }}>
                            {dateLabel(l.date, "d MMM")} · {humanise(l.category)}
                            {l.description ? ` · ${l.description}` : ""}
                            {l.distanceKm ? ` (${l.distanceKm} km)` : ""}
                          </Txt>
                          <Txt variant="caption">{money(l.amount, currency)}</Txt>
                          {l.receiptFileId ? (
                            <Pressable onPress={() => viewReceipt(l.receiptFileId!)} hitSlop={8} style={{ marginLeft: spacing.sm }}>
                              <Ionicons name="attach-outline" size={16} color={colors.brand[600]} />
                            </Pressable>
                          ) : null}
                        </View>
                      ))}
                      <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
                        {claim.status === "draft" && <Button title="Edit" variant="secondary" size="sm" onPress={() => setEditing(claim)} />}
                        {claim.status === "submitted" && <Button title="Withdraw" variant="ghost" size="sm" onPress={() => confirmWithdraw(claim)} />}
                      </View>
                    </View>
                  )}
                </Pressable>
              </View>
            ))}
          </Card>
        )}
      </Screen>

      {editing && <ExpenseSheet claim={editing === "new" ? null : editing} currency={currency} onClose={() => setEditing(null)} />}
    </SafeAreaView>
  );
}

interface DraftLine extends Omit<ExpenseLine, "amount"> {
  amount: string;
  distanceText?: string;
}

function ExpenseSheet({ claim, currency, onClose }: { claim: ExpenseItem | null; currency: string; onClose: () => void }) {
  const colors = useColors();
  const toast = useToast();
  const { session } = useSession();
  const policy = useExpensePolicy();
  const save = useSaveExpense();
  const uploadReceipt = useUploadReceipt();
  const [title, setTitle] = useState(claim?.title || "");
  const [purpose, setPurpose] = useState(claim?.purpose || "");
  const [advance, setAdvance] = useState(claim?.advanceAmount ? String(claim.advanceAmount) : "");
  const [lines, setLines] = useState<DraftLine[]>(claim?.lines?.length ? claim.lines.map((l) => ({ ...l, amount: String(l.amount), distanceText: l.distanceKm ? String(l.distanceKm) : "" })) : [emptyLine()]);
  const [pickingDate, setPickingDate] = useState<number | null>(null);
  const [uploadingLine, setUploadingLine] = useState<number | null>(null);

  function emptyLine(): DraftLine {
    return { date: todayString(), category: "", description: "", amount: "", receiptFileId: null, distanceText: "" };
  }

  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((current) => current.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const categories = (policy.data?.categories || []).map((c) => ({ value: c, label: humanise(c) }));
  const receiptAbove = policy.data?.receiptAbove || 0;

  const attach = async (i: number) => {
    const file = await pickPhoto();
    if (!file) return;
    setUploadingLine(i);
    try {
      const { id } = await uploadReceipt.mutateAsync({ file, employeeId: session?.employeeId });
      setLine(i, { receiptFileId: id });
      toast.success("Receipt attached.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not upload the receipt.");
    } finally {
      setUploadingLine(null);
    }
  };

  const submit = async (send: boolean) => {
    try {
      await save.mutateAsync({
        id: claim?.id,
        submit: send,
        draft: { title: title.trim(), purpose, advanceAmount: Number(advance) || 0, lines: lines.map((l) => ({ date: l.date, category: l.category, description: l.description, amount: Number(l.amount) || 0, receiptFileId: l.receiptFileId, distanceKm: l.distanceText ? Number(l.distanceText) : null })) },
      });
      toast.success(send ? "Claim submitted. Your approver has been notified." : "Draft saved.");
      onClose();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not save the claim.");
    }
  };

  const ready = title.trim().length > 0 && lines.length > 0 && lines.every((l) => l.category && Number(l.amount) > 0);

  return (
    <Sheet
      open
      onClose={onClose}
      title={claim ? `Edit claim #${claim.number}` : "New expense claim"}
      tall
      footer={
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button title="Save draft" variant="secondary" onPress={() => submit(false)} loading={save.isPending && save.variables?.submit === false} disabled={!title.trim()} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Submit" onPress={() => submit(true)} loading={save.isPending && save.variables?.submit === true} disabled={!ready} />
          </View>
        </View>
      }
    >
      <Field label="Title" placeholder="e.g. Client visit, Pune, 12 Mar" value={title} onChangeText={setTitle} />
      <Field label="Purpose (optional)" value={purpose} onChangeText={setPurpose} />
      <Field label="Advance already received (optional)" keyboardType="decimal-pad" value={advance} onChangeText={setAdvance} />

      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.sm }}>
        <Txt variant="label" style={{ flex: 1 }}>
          Expense lines
        </Txt>
        <Txt variant="label" tone="muted">
          Total <Txt variant="label">{money(total, currency)}</Txt>
        </Txt>
      </View>
      {lines.map((line, i) => (
        <View key={i} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}>
          <Txt variant="caption" tone="muted" style={{ marginBottom: 6 }}>
            Category
          </Txt>
          <Chips options={categories} value={line.category} onChange={(v) => setLine(i, { category: v })} />
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Pressable onPress={() => setPickingDate(i)} style={{ flex: 1, marginBottom: spacing.lg }}>
              <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>
                Date
              </Txt>
              <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface, minHeight: 48, justifyContent: "center" }}>
                <Txt variant="body">{dateLabel(line.date)}</Txt>
              </View>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Field label="Amount" keyboardType="decimal-pad" value={line.amount} onChangeText={(v) => setLine(i, { amount: v })} />
            </View>
          </View>
          <Field label="Description" placeholder="Optional" value={line.description || ""} onChangeText={(v) => setLine(i, { description: v })} />
          {policy.data?.mileageRate ? <Field label="Distance (km)" keyboardType="decimal-pad" value={line.distanceText || ""} onChangeText={(v) => setLine(i, { distanceText: v })} hint={`Mileage is paid at ${money(policy.data.mileageRate, currency)} per km.`} /> : null}
          {receiptAbove > 0 && Number(line.amount) > receiptAbove && !line.receiptFileId ? (
            <Txt variant="caption" tone="warning" style={{ marginBottom: spacing.sm }}>
              A receipt is required above {money(receiptAbove, currency)}.
            </Txt>
          ) : null}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Button title={line.receiptFileId ? "Receipt attached" : "Attach receipt"} variant={line.receiptFileId ? "ghost" : "secondary"} size="sm" icon={line.receiptFileId ? "checkmark-circle-outline" : "camera-outline"} onPress={() => attach(i)} loading={uploadingLine === i} />
            {lines.length > 1 && <Button title="Remove" variant="ghost" size="sm" onPress={() => setLines(lines.filter((_, idx) => idx !== i))} />}
          </View>
        </View>
      ))}
      <Button title="Add line" variant="secondary" size="sm" icon="add" onPress={() => setLines([...lines, emptyLine()])} />

      {policy.data && (policy.data.maxClaim || policy.data.receiptAbove) ? (
        <View style={{ marginTop: spacing.lg }}>
          <Note tone="info">
            {policy.data.maxClaim ? `A single claim may not exceed ${money(policy.data.maxClaim, currency)}. ` : ""}
            {policy.data.receiptAbove ? `Receipts are required for lines above ${money(policy.data.receiptAbove, currency)}.` : ""}
          </Note>
        </View>
      ) : (
        <View style={{ height: spacing.lg }} />
      )}

      <DatePickerSheet
        open={pickingDate !== null}
        value={pickingDate !== null ? lines[pickingDate]?.date || todayString() : todayString()}
        title="Date of the expense"
        onClose={() => setPickingDate(null)}
        onSelect={(value) => {
          if (pickingDate !== null) setLine(pickingDate, { date: value });
          setPickingDate(null);
        }}
      />
    </Sheet>
  );
}
