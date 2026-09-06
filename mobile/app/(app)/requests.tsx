import { useState } from "react";
import { Alert, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { format } from "date-fns";
import { useCancelRequest, useMyRequests, useRequestTypes, useSubmitRequest, type EmployeeRequestItem } from "../../src/api/hooks";
import { ApiError } from "../../src/api/client";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, Divider, EmptyState, ErrorState, Field, Loading, Screen, Txt } from "../../src/components/ui";
import { Chips, ScreenHeader, humanise } from "../../src/components/ScreenHeader";
import { spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { pending: "warning", approved: "success", completed: "success", rejected: "danger", cancelled: "neutral" };
const MOBILE_TYPES = ["wfh", "comp_off", "advance", "other"];

/**
 * Requests an employee can raise from the phone: work from home, comp-off,
 * an advance, or a free-form ask. Letters and detail changes stay on the
 * web, where the forms need more room.
 */
export default function Requests() {
  const colors = useColors();
  const toast = useToast();
  const query = useMyRequests();
  const types = useRequestTypes();
  const submit = useSubmitRequest();
  const cancel = useCancelRequest();

  const [creating, setCreating] = useState(false);
  const [type, setType] = useState<string>("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setError(null);
    const payload: Record<string, unknown> = {};
    if (type === "wfh") Object.assign(payload, { fromDate: fields.fromDate, toDate: fields.toDate || fields.fromDate });
    if (type === "comp_off") Object.assign(payload, { workedOn: fields.workedOn, days: 1 });
    if (type === "advance") Object.assign(payload, { amount: Number(fields.amount) });
    if (type === "other") Object.assign(payload, { subject: fields.subject });
    try {
      await submit.mutateAsync({ type, payload, reason });
      toast.success("Request sent.");
      setCreating(false);
      setType("");
      setFields({});
      setReason("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not send the request.");
    }
  };

  const withdraw = (request: EmployeeRequestItem) =>
    Alert.alert("Withdraw this request?", request.summary, [
      { text: "Keep it", style: "cancel" },
      { text: "Withdraw", style: "destructive", onPress: () => cancel.mutate(request.id, { onSuccess: () => toast.success("Withdrawn."), onError: () => toast.error("Could not withdraw.") }) },
    ]);

  const available = (types.data || []).filter((t) => MOBILE_TYPES.includes(t.key));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={colors.brand[600]} />}>
        <ScreenHeader title="My requests" action={!creating ? <Button title="New" size="sm" icon="add" onPress={() => setCreating(true)} /> : undefined} />

        {creating && (
          <Card style={{ marginBottom: spacing.lg }}>
            <Txt variant="heading" style={{ marginBottom: spacing.md }}>
              What do you need?
            </Txt>
            <Chips options={available.map((t) => ({ value: t.key, label: t.label }))} value={type} onChange={(v) => { setType(v); setFields({}); }} />
            {type === "wfh" && (
              <>
                <Field label="From (YYYY-MM-DD)" placeholder={format(new Date(), "yyyy-MM-dd")} value={fields.fromDate || ""} onChangeText={(v) => setFields({ ...fields, fromDate: v })} autoCapitalize="none" />
                <Field label="To (YYYY-MM-DD)" placeholder="Same day if blank" value={fields.toDate || ""} onChangeText={(v) => setFields({ ...fields, toDate: v })} autoCapitalize="none" />
              </>
            )}
            {type === "comp_off" && <Field label="Day you worked (YYYY-MM-DD)" placeholder={format(new Date(), "yyyy-MM-dd")} value={fields.workedOn || ""} onChangeText={(v) => setFields({ ...fields, workedOn: v })} autoCapitalize="none" />}
            {type === "advance" && <Field label="Amount" placeholder="5000" keyboardType="number-pad" value={fields.amount || ""} onChangeText={(v) => setFields({ ...fields, amount: v })} />}
            {type === "other" && <Field label="Subject" value={fields.subject || ""} onChangeText={(v) => setFields({ ...fields, subject: v })} />}
            {type ? <Field label={type === "other" ? "Details" : "Reason (optional)"} value={reason} onChangeText={setReason} multiline numberOfLines={3} style={{ minHeight: 70, textAlignVertical: "top" }} /> : null}
            {error && (
              <Txt variant="caption" tone="danger" style={{ marginBottom: spacing.md }}>
                {error}
              </Txt>
            )}
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button title="Cancel" variant="secondary" onPress={() => setCreating(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Send" onPress={send} loading={submit.isPending} disabled={!type} />
              </View>
            </View>
          </Card>
        )}

        {query.isLoading ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState message={(query.error as Error).message} onRetry={query.refetch} />
        ) : !query.data?.length ? (
          <EmptyState icon="clipboard-outline" title="No requests yet" body="Ask for a day of work from home, claim a comp-off, or request an advance. You are told the moment it is decided." />
        ) : (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {query.data.map((request, index) => (
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
                    {request.typeLabel} · {format(new Date(request.createdAt), "d MMM")}
                    {request.decidedBy ? ` · by ${request.decidedBy}` : ""}
                  </Txt>
                  {request.decisionComment ? (
                    <Txt variant="caption" tone="muted" style={{ marginTop: 3, fontStyle: "italic" }}>
                      “{request.decisionComment}”
                    </Txt>
                  ) : null}
                  {request.status === "pending" && (
                    <View style={{ marginTop: spacing.sm, alignSelf: "flex-start" }}>
                      <Button title="Withdraw" variant="ghost" size="sm" onPress={() => withdraw(request)} />
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
