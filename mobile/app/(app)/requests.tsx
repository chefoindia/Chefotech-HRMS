import { useEffect, useState } from "react";
import { Alert, RefreshControl, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCancelRequest, useDirectory, useLeaveBalances, useMyRequests, useRequestTypes, useShifts, useSubmitRequest, type EmployeeRequestItem } from "../../src/api/hooks";
import { ApiError } from "../../src/api/client";
import { useSession } from "../../src/auth/session";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, Divider, EmptyState, ErrorState, Field, Loading, Screen, Txt } from "../../src/components/ui";
import { Chips, ScreenHeader } from "../../src/components/ScreenHeader";
import { Note, PickerSheet, SelectField, Sheet, TabStrip } from "../../src/components/Sheet";
import { DatePickerSheet } from "../../src/components/DatePickerSheet";
import { spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";
import { dateLabel, humanise, relative, todayString, upcomingPeriods } from "../../src/lib/format";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { pending: "warning", approved: "success", completed: "success", rejected: "danger", cancelled: "neutral" };

const LETTERS = [
  { value: "BONAFIDE", label: "Bonafide certificate" },
  { value: "ADDRESS_PROOF", label: "Address proof letter" },
  { value: "SALARY_CERTIFICATE", label: "Salary certificate" },
  { value: "NOC", label: "No objection certificate" },
  { value: "EXPERIENCE", label: "Experience certificate" },
];

const PROFILE_FIELDS: Record<string, { key: string; label: string }[]> = {
  bank: [
    { key: "bankName", label: "Bank" },
    { key: "accountNumber", label: "Account number" },
    { key: "ifscCode", label: "IFSC" },
    { key: "accountHolderName", label: "Account holder name" },
  ],
  personal: [
    { key: "phone", label: "Phone" },
    { key: "personalEmail", label: "Personal email" },
    { key: "currentAddress.line1", label: "Address line 1" },
    { key: "currentAddress.city", label: "City" },
    { key: "currentAddress.postalCode", label: "Postal code" },
  ],
  statutory: [
    { key: "uan", label: "UAN" },
    { key: "pfNumber", label: "PF number" },
    { key: "esiNumber", label: "ESI number" },
    { key: "taxId", label: "PAN" },
  ],
};

function payloadSummary(request: EmployeeRequestItem) {
  const p = request.payload as Record<string, string | number>;
  switch (request.type) {
    case "wfh":
    case "shift_swap":
      return `${dateLabel(p.fromDate as string)} → ${dateLabel(p.toDate as string)}`;
    case "comp_off":
      return `${p.days ?? 1} day(s) for ${dateLabel(p.workedOn as string)}`;
    case "encashment":
      return `${p.days} day(s)`;
    case "advance":
      return `Amount ${p.amount}`;
    default:
      return "";
  }
}

function effectSummary(request: EmployeeRequestItem) {
  const e = request.effect as Record<string, unknown> | null;
  if (!e) return null;
  if (e.error) return `Could not be applied: ${String(e.error)}`;
  if (e.markedDates) return `${(e.markedDates as string[]).length} day(s) marked as work from home`;
  if (e.credited) return `${e.credited} day(s) credited`;
  if (e.amount && e.days) return `${e.days} day(s) → ${e.amount} on the next payslip`;
  if (e.documentName) return `Generated: ${String(e.documentName)}`;
  if (e.applied) return `Updated: ${(e.applied as string[]).join(", ")}`;
  if (e.assigned) return "Shift updated";
  if (e.recoveryInputId) return "Recovery scheduled with payroll";
  return null;
}

/**
 * My requests — the web portal's /me/requests: work from home, comp-off,
 * encashment, shift changes, letters, detail changes and advances.
 */
export default function Requests() {
  const colors = useColors();
  const toast = useToast();
  const params = useLocalSearchParams<{ type?: string }>();
  const { session } = useSession();
  const query = useMyRequests();
  const cancel = useCancelRequest();
  const [tab, setTab] = useState<"pending" | "done">("pending");
  const [creating, setCreating] = useState<string | null>(null);
  const canSubmit = !session || session.permissions.includes("request.submit");

  useEffect(() => {
    if (params.type) setCreating(params.type);
  }, [params.type]);

  const rows = query.data || [];
  const pending = rows.filter((r) => r.status === "pending");
  const done = rows.filter((r) => r.status !== "pending");
  const shown = tab === "pending" ? pending : done;

  const withdraw = (request: EmployeeRequestItem) =>
    Alert.alert("Withdraw this request?", request.summary, [
      { text: "Keep it", style: "cancel" },
      { text: "Withdraw", style: "destructive", onPress: () => cancel.mutateAsync(request.id).then(() => toast.success("Request withdrawn.")).catch((e) => toast.error(e instanceof ApiError ? e.message : "Could not withdraw.")) },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={colors.brand[600]} />}>
        <ScreenHeader title="My requests" action={canSubmit ? <Button title="New" size="sm" icon="add" onPress={() => setCreating("")} /> : undefined} />
        <TabStrip
          items={[
            { key: "pending", label: "Waiting", count: pending.length },
            { key: "done", label: "Decided", count: done.length },
          ]}
          active={tab}
          onChange={setTab}
        />

        {query.isLoading ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState message={(query.error as Error).message} onRetry={query.refetch} />
        ) : !shown.length ? (
          <Card>
            <EmptyState icon="clipboard-outline" title={tab === "pending" ? "Nothing waiting" : "No decided requests yet"} body="Ask for a day of work from home, claim a comp-off for a weekend worked, or request a letter — it goes to the right person and you are told when it is decided." action={canSubmit ? <Button title="New request" onPress={() => setCreating("")} /> : undefined} />
          </Card>
        ) : (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {shown.map((request, index) => {
              const detail = payloadSummary(request);
              const effect = effectSummary(request);
              return (
                <View key={request.id}>
                  {index > 0 && <Divider />}
                  <View style={{ paddingVertical: spacing.md }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                      <Txt variant="bodyMedium" style={{ flex: 1 }} numberOfLines={2}>
                        {request.summary}
                      </Txt>
                      <Badge label={request.status === "completed" ? "Approved" : humanise(request.status)} tone={STATUS_TONE[request.status] ?? "neutral"} />
                    </View>
                    <Txt variant="caption" tone="muted" style={{ marginTop: 3 }}>
                      {request.typeLabel}
                      {detail ? ` · ${detail}` : ""} · asked {relative(request.createdAt)}
                      {request.decidedAt ? ` · ${request.status === "rejected" ? "rejected" : "approved"} ${relative(request.decidedAt)}${request.decidedBy ? ` by ${request.decidedBy}` : ""}` : ""}
                    </Txt>
                    {request.reason ? (
                      <Txt variant="caption" style={{ marginTop: 3 }}>
                        {request.reason}
                      </Txt>
                    ) : null}
                    {request.decisionComment ? (
                      <Txt variant="caption" tone="muted" style={{ marginTop: 3, fontStyle: "italic" }}>
                        “{request.decisionComment}”
                      </Txt>
                    ) : null}
                    {effect ? (
                      <Txt variant="caption" tone={effect.startsWith("Could not") ? "danger" : "success"} style={{ marginTop: 3 }}>
                        {effect}
                      </Txt>
                    ) : null}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm }}>
                      {request.viaWorkflow && request.status === "pending" && <Badge label="In approval workflow" tone="info" />}
                      {request.status === "pending" && <Button title="Withdraw" variant="ghost" size="sm" onPress={() => withdraw(request)} />}
                    </View>
                  </View>
                </View>
              );
            })}
          </Card>
        )}
      </Screen>

      {creating !== null && <RequestSheet initialType={creating} onClose={() => setCreating(null)} />}
    </SafeAreaView>
  );
}

function RequestSheet({ initialType, onClose }: { initialType: string; onClose: () => void }) {
  const toast = useToast();
  const types = useRequestTypes();
  const submit = useSubmitRequest();
  const [type, setType] = useState(initialType);
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [reason, setReason] = useState("");
  const [picking, setPicking] = useState<string | null>(null);
  const [pickingList, setPickingList] = useState<"leaveType" | "shift" | "colleague" | "letter" | "section" | null>(null);

  const balances = useLeaveBalances();
  const shifts = useShifts(type === "shift_swap");
  const colleagues = useDirectory({ page: 1 });

  useEffect(() => {
    setPayload({});
  }, [type]);

  const info = (types.data || []).find((t) => t.key === type);
  const set = (key: string, value: unknown) => setPayload((p) => ({ ...p, [key]: value }));
  const str = (key: string) => (payload[key] as string) || "";

  const send = async () => {
    try {
      await submit.mutateAsync({ type, payload, reason });
      toast.success("Request sent. You will be told as soon as it is decided.");
      onClose();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not send that request.");
    }
  };

  const encashable = (balances.data || []).filter((b) => b.hasBalance && (b.available || 0) > 0);
  const changes = (payload.changes as Record<string, string>) || {};
  const section = str("section");
  const dateField = (key: string, label: string) => <SelectField label={label} value={str(key) ? dateLabel(str(key)) : ""} placeholder="Choose a date" onPress={() => setPicking(key)} />;

  return (
    <Sheet
      open
      onClose={onClose}
      title="New request"
      tall
      footer={
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button title="Cancel" variant="secondary" onPress={onClose} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Send request" onPress={send} loading={submit.isPending} disabled={!type} />
          </View>
        </View>
      }
    >
      <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>
        What do you need?
      </Txt>
      {types.isLoading ? <Loading /> : <Chips options={(types.data || []).map((t) => ({ value: t.key, label: t.label }))} value={type} onChange={setType} />}
      {info && (
        <Txt variant="caption" tone="subtle" style={{ marginTop: -spacing.sm, marginBottom: spacing.lg }}>
          {info.description} Decided by {info.approver === "manager" ? "your reporting manager" : "HR"}.
        </Txt>
      )}

      {type === "wfh" && (
        <>
          {dateField("fromDate", "From")}
          {dateField("toDate", "To")}
        </>
      )}

      {type === "comp_off" && (
        <>
          {dateField("workedOn", "Day you worked")}
          <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>
            Days to credit
          </Txt>
          <Chips
            options={[
              { value: "0.5", label: "Half day" },
              { value: "1", label: "One day" },
              { value: "2", label: "Two days" },
            ]}
            value={String(payload.days ?? "1")}
            onChange={(v) => set("days", Number(v))}
          />
        </>
      )}

      {type === "encashment" && (
        <>
          <SelectField label="Leave type" value={encashable.find((b) => b.leaveType.id === str("leaveTypeId"))?.leaveType.name || ""} onPress={() => setPickingList("leaveType")} />
          <Field label="Days to encash" keyboardType="decimal-pad" value={payload.days ? String(payload.days) : ""} onChangeText={(v) => set("days", Number(v))} />
          <Note tone="info">The amount is worked out from your salary and paid with the next payslip once HR approves.</Note>
        </>
      )}

      {type === "shift_swap" && (
        <>
          <SelectField label="Shift you want" value={(shifts.data || []).find((s) => s.id === str("shiftId"))?.name || ""} onPress={() => setPickingList("shift")} />
          <SelectField label="Swap with a colleague (optional)" value={(colleagues.data?.items || []).find((c) => c.id === str("swapWithEmployeeId"))?.name || ""} placeholder="Nobody — just change mine" onPress={() => setPickingList("colleague")} />
          {dateField("fromDate", "From")}
          {dateField("toDate", "To")}
        </>
      )}

      {type === "letter" && (
        <>
          <SelectField label="Letter" value={LETTERS.find((l) => l.value === str("templateCode"))?.label || ""} onPress={() => setPickingList("letter")} />
          <Field label="Purpose (optional)" placeholder="e.g. visa application, bank loan" value={str("purpose")} onChangeText={(v) => set("purpose", v)} />
          <Txt variant="caption" tone="subtle" style={{ marginBottom: spacing.lg }}>
            HR approves and the letter is generated into your documents automatically.
          </Txt>
        </>
      )}

      {type === "profile_change" && (
        <>
          <SelectField label="Which details" value={section ? humanise(section) : ""} onPress={() => setPickingList("section")} />
          {section &&
            PROFILE_FIELDS[section].map((f) => <Field key={f.key} label={f.label} placeholder="Leave blank to keep" value={changes[f.key] || ""} onChangeText={(v) => set("changes", { ...changes, [f.key]: v })} />)}
          <Txt variant="caption" tone="subtle" style={{ marginBottom: spacing.lg }}>
            Only the fields you fill in are changed, after HR approves.
          </Txt>
        </>
      )}

      {type === "advance" && (
        <>
          <Field label="Amount" keyboardType="number-pad" value={payload.amount ? String(payload.amount) : ""} onChangeText={(v) => set("amount", Number(v))} />
          <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>
            Recover from salary of
          </Txt>
          <Chips options={[{ value: "", label: "Next payslip" }, ...upcomingPeriods(5)]} value={str("recoverInPeriod")} onChange={(v) => set("recoverInPeriod", v || undefined)} />
        </>
      )}

      {type === "other" && <Field label="Subject" value={str("subject")} onChangeText={(v) => set("subject", v)} />}

      {type ? <Field label={type === "other" ? "Details" : "Reason (optional)"} value={reason} onChangeText={setReason} multiline numberOfLines={3} style={{ minHeight: 70, textAlignVertical: "top" }} /> : null}

      <DatePickerSheet
        open={picking !== null}
        value={picking ? str(picking) || todayString() : todayString()}
        minimumDate={picking === "toDate" ? str("fromDate") || undefined : undefined}
        title="Choose a date"
        onClose={() => setPicking(null)}
        onSelect={(value) => {
          if (picking) {
            set(picking, value);
            if (picking === "fromDate" && (!str("toDate") || str("toDate") < value)) set("toDate", value);
          }
          setPicking(null);
        }}
      />
      <PickerSheet open={pickingList === "leaveType"} onClose={() => setPickingList(null)} title="Leave type" options={encashable.map((b) => ({ value: b.leaveType.id, label: b.leaveType.name, hint: `${b.available} available` }))} value={str("leaveTypeId")} onSelect={(v) => set("leaveTypeId", v)} />
      <PickerSheet open={pickingList === "shift"} onClose={() => setPickingList(null)} title="Shift" options={(shifts.data || []).map((s) => ({ value: s.id, label: s.name, hint: s.startTime ? `${s.startTime}–${s.endTime}` : undefined }))} value={str("shiftId")} onSelect={(v) => set("shiftId", v)} />
      <PickerSheet open={pickingList === "colleague"} onClose={() => setPickingList(null)} title="Colleague" options={(colleagues.data?.items || []).map((c) => ({ value: c.id, label: c.name, hint: c.employeeCode }))} value={str("swapWithEmployeeId")} onSelect={(v) => set("swapWithEmployeeId", v || undefined)} allowClear clearLabel="Nobody — just change mine" />
      <PickerSheet open={pickingList === "letter"} onClose={() => setPickingList(null)} title="Letter" options={LETTERS} value={str("templateCode")} onSelect={(v) => set("templateCode", v)} searchable={false} />
      <PickerSheet
        open={pickingList === "section"}
        onClose={() => setPickingList(null)}
        title="Which details"
        options={Object.keys(PROFILE_FIELDS).map((k) => ({ value: k, label: humanise(k) }))}
        value={section}
        onSelect={(v) => {
          set("section", v);
          set("changes", {});
        }}
        searchable={false}
      />
    </Sheet>
  );
}
