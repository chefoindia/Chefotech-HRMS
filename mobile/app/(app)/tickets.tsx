import { useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { format } from "date-fns";
import { useCreateTicket, useMyTickets, useTicket, useTicketAction } from "../../src/api/hooks";
import { ApiError } from "../../src/api/client";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, Divider, EmptyState, ErrorState, Field, Loading, Screen, Txt } from "../../src/components/ui";
import { Chips, ScreenHeader, humanise } from "../../src/components/ScreenHeader";
import { radius, spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";

const CATEGORIES = [
  { value: "it", label: "IT" },
  { value: "hr", label: "HR" },
  { value: "payroll", label: "Payroll" },
  { value: "facilities", label: "Facilities" },
  { value: "other", label: "Other" },
];
const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];
const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { open: "info", in_progress: "brand" as never, waiting_on_requester: "warning", resolved: "success", closed: "neutral" };

/** Help desk from the phone: raise, follow, reply, close. */
export default function Tickets() {
  const colors = useColors();
  const toast = useToast();
  const list = useMyTickets();
  const create = useCreateTicket();
  const act = useTicketAction();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({ subject: "", description: "", category: "it", priority: "normal" });
  const [error, setError] = useState<string | null>(null);

  const raise = async () => {
    setError(null);
    try {
      const ticket = await create.mutateAsync(form);
      toast.success(`Ticket #${ticket.number} raised.`);
      setCreating(false);
      setForm({ subject: "", description: "", category: "it", priority: "normal" });
      setOpenId(ticket.id);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not raise the ticket.");
    }
  };

  if (openId) return <TicketDetail id={openId} onBack={() => setOpenId(null)} act={act} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={list.refetch} tintColor={colors.brand[600]} />}>
        <ScreenHeader title="Help desk" action={!creating ? <Button title="Raise" size="sm" icon="add" onPress={() => setCreating(true)} /> : undefined} />

        {creating && (
          <Card style={{ marginBottom: spacing.lg }}>
            <Field label="What do you need help with?" placeholder="e.g. Laptop will not charge" value={form.subject} onChangeText={(v) => setForm({ ...form, subject: v })} />
            <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>Category</Txt>
            <Chips options={CATEGORIES} value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
            <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>Priority</Txt>
            <Chips options={PRIORITIES} value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} />
            <Field label="Details" placeholder="What happened, and when you need it by" value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} multiline numberOfLines={4} style={{ minHeight: 90, textAlignVertical: "top" }} />
            {error && <Txt variant="caption" tone="danger" style={{ marginBottom: spacing.md }}>{error}</Txt>}
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}><Button title="Cancel" variant="secondary" onPress={() => setCreating(false)} /></View>
              <View style={{ flex: 1 }}><Button title="Raise ticket" onPress={raise} loading={create.isPending} disabled={form.subject.trim().length < 3} /></View>
            </View>
          </Card>
        )}

        {list.isLoading ? (
          <Loading />
        ) : list.isError ? (
          <ErrorState message={(list.error as Error).message} onRetry={list.refetch} />
        ) : !list.data?.length ? (
          <EmptyState icon="help-buoy-outline" title="No tickets" body="Something broken, missing or unclear? Raise a ticket and the right team picks it up." />
        ) : (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {list.data.map((ticket, index) => (
              <View key={ticket.id}>
                {index > 0 && <Divider />}
                <Pressable onPress={() => setOpenId(ticket.id)} style={{ paddingVertical: spacing.md }} accessibilityRole="button">
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Txt variant="caption" tone="subtle">#{ticket.number}</Txt>
                    <Txt variant="bodyMedium" style={{ flex: 1 }} numberOfLines={1}>{ticket.subject}</Txt>
                    <Badge label={humanise(ticket.status)} tone={STATUS_TONE[ticket.status] ?? "neutral"} />
                  </View>
                  <Txt variant="caption" tone="muted" style={{ marginTop: 3 }}>
                    {ticket.category.toUpperCase()} · {humanise(ticket.priority)} · {ticket.assignee ? `with ${ticket.assignee.name}` : "not yet assigned"} · {format(new Date(ticket.lastActivityAt), "d MMM")}
                  </Txt>
                </Pressable>
              </View>
            ))}
          </Card>
        )}
      </Screen>
    </SafeAreaView>
  );
}

function TicketDetail({ id, onBack, act }: { id: string; onBack: () => void; act: ReturnType<typeof useTicketAction> }) {
  const colors = useColors();
  const toast = useToast();
  const query = useTicket(id);
  const [body, setBody] = useState("");
  const [rating, setRating] = useState(0);
  const ticket = query.data;

  const run = (input: Parameters<typeof act.mutateAsync>[0], done: string) =>
    act.mutateAsync(input).then(() => { toast.success(done); setBody(""); }).catch((caught) => toast.error(caught instanceof ApiError ? caught.message : "That did not work."));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={colors.brand[600]} />}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.lg }}>
          <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Txt variant="label" tone="brand">‹ Tickets</Txt>
          </Pressable>
        </View>
        {query.isLoading || !ticket ? (
          <Loading />
        ) : (
          <>
            <Card style={{ marginBottom: spacing.lg }}>
              <Txt variant="caption" tone="subtle">#{ticket.number} · {ticket.category.toUpperCase()} · {humanise(ticket.priority)}</Txt>
              <Txt variant="heading" style={{ marginTop: 4 }}>{ticket.subject}</Txt>
              <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
                <Badge label={humanise(ticket.status)} tone={STATUS_TONE[ticket.status] ?? "neutral"} />
                {ticket.isOverdue && <Badge label="Overdue" tone="danger" />}
              </View>
              {ticket.description ? <Txt variant="body" style={{ marginTop: spacing.md, lineHeight: 21 }}>{ticket.description}</Txt> : null}
              {ticket.resolutionNote ? (
                <View style={{ marginTop: spacing.md, backgroundColor: colors.successBg, borderRadius: radius.md, padding: spacing.md }}>
                  <Txt variant="label" tone="success">Resolution</Txt>
                  <Txt variant="body" style={{ marginTop: 2 }}>{ticket.resolutionNote}</Txt>
                </View>
              ) : null}
            </Card>

            {(ticket.comments || []).map((c) => (
              <Card key={c.id} style={{ marginBottom: spacing.sm }}>
                <Txt variant="caption" tone="muted">{c.authorName} · {format(new Date(c.createdAt), "d MMM HH:mm")}</Txt>
                <Txt variant="body" style={{ marginTop: 4, lineHeight: 21 }}>{c.body}</Txt>
              </Card>
            ))}

            {ticket.status !== "closed" ? (
              <Card style={{ marginTop: spacing.md }}>
                <Field placeholder="Write a reply" value={body} onChangeText={setBody} multiline numberOfLines={3} style={{ minHeight: 70, textAlignVertical: "top" }} />
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}><Button title="Close ticket" variant="secondary" onPress={() => run({ id, action: "close", rating: rating || undefined }, "Ticket closed.")} /></View>
                  <View style={{ flex: 1 }}><Button title="Send" onPress={() => run({ id, action: "comment", body }, "Reply sent.")} disabled={!body.trim()} loading={act.isPending} /></View>
                </View>
                {ticket.status === "resolved" && (
                  <View style={{ marginTop: spacing.md }}>
                    <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>Rate the help before closing</Txt>
                    <Chips options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: "★".repeat(n) }))} value={rating ? String(rating) : ""} onChange={(v) => setRating(Number(v))} />
                  </View>
                )}
              </Card>
            ) : (
              <View style={{ marginTop: spacing.md }}>
                <Button title="Reopen" variant="secondary" onPress={() => run({ id, action: "reopen" }, "Reopened.")} />
              </View>
            )}
          </>
        )}
      </Screen>
    </SafeAreaView>
  );
}
