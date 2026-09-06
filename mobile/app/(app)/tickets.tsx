import { useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCreateTicket, useMyTickets, useTicket, useTicketAction } from "../../src/api/hooks";
import { ApiError } from "../../src/api/client";
import { useSession } from "../../src/auth/session";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, Divider, EmptyState, ErrorState, Field, Loading, Screen, Txt } from "../../src/components/ui";
import { Chips, ScreenHeader } from "../../src/components/ScreenHeader";
import { Note, TabStrip } from "../../src/components/Sheet";
import { radius, spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";
import { dateTimeLabel, humanise, relative } from "../../src/lib/format";

const CATEGORIES = [
  { value: "it", label: "IT" },
  { value: "hr", label: "HR" },
  { value: "payroll", label: "Payroll" },
  { value: "facilities", label: "Facilities" },
  { value: "finance", label: "Finance" },
  { value: "other", label: "Other" },
];
const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];
const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info" | "brand"> = { open: "info", in_progress: "brand", waiting_on_requester: "warning", resolved: "success", closed: "neutral" };
const PRIORITY_TONE: Record<string, "neutral" | "info" | "warning" | "danger"> = { low: "neutral", normal: "info", high: "warning", urgent: "danger" };

/** Help desk — the web portal's /me/tickets: raise, follow, reply, rate, close. */
export default function Tickets() {
  const colors = useColors();
  const toast = useToast();
  const { session } = useSession();
  const list = useMyTickets();
  const create = useCreateTicket();
  const act = useTicketAction();
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({ subject: "", description: "", category: "it", priority: "normal" });
  const canCreate = !session || session.permissions.includes("ticket.create");

  const raise = async () => {
    try {
      const ticket = await create.mutateAsync(form);
      toast.success(`Ticket #${ticket.number} raised. The help desk has been notified.`);
      setCreating(false);
      setForm({ subject: "", description: "", category: "it", priority: "normal" });
      setOpenId(ticket.id);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not raise the ticket.");
    }
  };

  if (openId) return <TicketDetail id={openId} onBack={() => setOpenId(null)} act={act} />;

  const rows = list.data || [];
  const open = rows.filter((t) => t.status !== "closed");
  const closed = rows.filter((t) => t.status === "closed");
  const shown = tab === "open" ? open : closed;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={list.refetch} tintColor={colors.brand[600]} />}>
        <ScreenHeader title="Help desk" action={!creating && canCreate ? <Button title="Raise" size="sm" icon="add" onPress={() => setCreating(true)} /> : undefined} />

        {creating && (
          <Card style={{ marginBottom: spacing.lg }}>
            <Field label="What do you need help with?" placeholder="e.g. Laptop will not turn on" value={form.subject} onChangeText={(v) => setForm({ ...form, subject: v })} autoFocus />
            <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>
              Category
            </Txt>
            <Chips options={CATEGORIES} value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
            <Txt variant="label" tone="muted" style={{ marginBottom: 6 }}>
              Priority
            </Txt>
            <Chips options={PRIORITIES} value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} />
            <Txt variant="caption" tone="subtle" style={{ marginTop: -spacing.sm, marginBottom: spacing.md }}>
              Urgent means you cannot work until it is fixed.
            </Txt>
            <Field label="Details" placeholder="What happened, what you have tried, and when you need it by." value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} multiline numberOfLines={4} style={{ minHeight: 90, textAlignVertical: "top" }} />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button title="Cancel" variant="secondary" onPress={() => setCreating(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Raise ticket" onPress={raise} loading={create.isPending} disabled={form.subject.trim().length < 3} />
              </View>
            </View>
          </Card>
        )}

        <TabStrip
          items={[
            { key: "open", label: "Open", count: open.length },
            { key: "closed", label: "Closed", count: closed.length },
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
            <EmptyState icon="help-buoy-outline" title={tab === "open" ? "No open tickets" : "No closed tickets"} body="Something broken, missing or unclear? Raise a ticket and the right team picks it up." action={canCreate ? <Button title="Raise a ticket" onPress={() => setCreating(true)} /> : undefined} />
          </Card>
        ) : (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {shown.map((ticket, index) => (
              <View key={ticket.id}>
                {index > 0 && <Divider />}
                <Pressable onPress={() => setOpenId(ticket.id)} style={{ paddingVertical: spacing.md }} accessibilityRole="button">
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Txt variant="caption" tone="subtle">
                      #{ticket.number}
                    </Txt>
                    <Txt variant="bodyMedium" style={{ flex: 1 }} numberOfLines={1}>
                      {ticket.subject}
                    </Txt>
                    <Badge label={humanise(ticket.status)} tone={STATUS_TONE[ticket.status] ?? "neutral"} />
                  </View>
                  <Txt variant="caption" tone="muted" style={{ marginTop: 3 }}>
                    {ticket.category.toUpperCase()} · {humanise(ticket.priority)} · {ticket.assignee ? `with ${ticket.assignee.name}` : "not yet assigned"} · updated {relative(ticket.lastActivityAt)}
                    {ticket.commentCount ? ` · ${ticket.commentCount} repl${ticket.commentCount === 1 ? "y" : "ies"}` : ""}
                  </Txt>
                  {ticket.status === "waiting_on_requester" && (
                    <View style={{ marginTop: 4, alignSelf: "flex-start" }}>
                      <Badge label="Your reply needed" tone="warning" />
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

function TicketDetail({ id, onBack, act }: { id: string; onBack: () => void; act: ReturnType<typeof useTicketAction> }) {
  const colors = useColors();
  const toast = useToast();
  const { session } = useSession();
  const query = useTicket(id);
  const [body, setBody] = useState("");
  const [closing, setClosing] = useState(false);
  const [rating, setRating] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const ticket = query.data;

  const run = (input: Parameters<typeof act.mutateAsync>[0], done: string) =>
    act
      .mutateAsync(input)
      .then(() => {
        toast.success(done);
        setBody("");
        setClosing(false);
      })
      .catch((caught) => toast.error(caught instanceof ApiError ? caught.message : "That did not work."));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={colors.brand[600]} />}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.lg }}>
          <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Txt variant="label" tone="brand">
              ‹ Tickets
            </Txt>
          </Pressable>
        </View>
        {query.isLoading || !ticket ? (
          <Loading />
        ) : (
          <>
            <Card style={{ marginBottom: spacing.lg }}>
              <Txt variant="heading">
                #{ticket.number} {ticket.subject}
              </Txt>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm }}>
                <Badge label={humanise(ticket.status)} tone={STATUS_TONE[ticket.status] ?? "neutral"} />
                <Badge label={humanise(ticket.priority)} tone={PRIORITY_TONE[ticket.priority] ?? "neutral"} />
                <Badge label={ticket.category.toUpperCase()} tone="neutral" />
                {ticket.isOverdue && <Badge label="Overdue" tone="danger" />}
              </View>
              <Txt variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
                by {ticket.requester.name}
                {ticket.requester.department ? ` (${ticket.requester.department})` : ""} · {relative(ticket.createdAt)}
                {ticket.dueAt ? ` · due ${dateTimeLabel(ticket.dueAt)}` : ""}
                {ticket.assignee ? ` · with ${ticket.assignee.name}` : ""}
              </Txt>
              {ticket.description ? (
                <Txt variant="body" style={{ marginTop: spacing.md, lineHeight: 21 }}>
                  {ticket.description}
                </Txt>
              ) : null}
              {ticket.resolutionNote ? (
                <View style={{ marginTop: spacing.md, backgroundColor: colors.successBg, borderRadius: radius.md, padding: spacing.md }}>
                  <Txt variant="label" tone="success">
                    Resolution
                  </Txt>
                  <Txt variant="body" style={{ marginTop: 2 }}>
                    {ticket.resolutionNote}
                  </Txt>
                </View>
              ) : null}
              {ticket.rating ? (
                <Txt variant="caption" tone="muted" style={{ marginTop: spacing.md }}>
                  Rated {"★".repeat(ticket.rating)}
                  {ticket.ratingComment ? ` — “${ticket.ratingComment}”` : ""}
                </Txt>
              ) : null}
            </Card>

            {(ticket.comments || []).length === 0 && (
              <Txt variant="caption" tone="subtle" style={{ marginBottom: spacing.md }}>
                No replies yet.
              </Txt>
            )}
            {(ticket.comments || []).map((c) => (
              <Card key={c.id} style={{ marginBottom: spacing.sm, ...(c.authorUserId === session?.user.id ? { backgroundColor: colors.brand[50] } : {}) }}>
                <Txt variant="caption" tone="muted">
                  <Txt variant="caption">{c.authorName}</Txt> · {relative(c.createdAt)}
                </Txt>
                <Txt variant="body" style={{ marginTop: 4, lineHeight: 21 }}>
                  {c.body}
                </Txt>
              </Card>
            ))}

            {ticket.status !== "closed" ? (
              <Card style={{ marginTop: spacing.md }}>
                <Field placeholder="Reply" value={body} onChangeText={setBody} multiline numberOfLines={3} style={{ minHeight: 70, textAlignVertical: "top" }} />
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button title={ticket.status === "resolved" ? "Close" : "Close ticket"} variant="secondary" onPress={() => setClosing(!closing)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button title="Send" icon="send-outline" onPress={() => run({ id, action: "comment", body }, "Reply sent.")} disabled={!body.trim()} loading={act.isPending} />
                  </View>
                </View>
                {closing && (
                  <View style={{ marginTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
                    <Txt variant="label" style={{ marginBottom: 6 }}>
                      How was the help?
                    </Txt>
                    <Chips options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: "★".repeat(n) }))} value={rating ? String(rating) : ""} onChange={(v) => setRating(Number(v))} />
                    <Field placeholder="Anything to add? (optional)" value={ratingComment} onChangeText={setRatingComment} />
                    <View style={{ flexDirection: "row", gap: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <Button title="Not yet" variant="secondary" size="sm" onPress={() => setClosing(false)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button title="Close ticket" size="sm" onPress={() => run({ id, action: "close", rating: rating || undefined, ratingComment: rating ? ratingComment : undefined }, "Ticket closed.")} loading={act.isPending} />
                      </View>
                    </View>
                  </View>
                )}
              </Card>
            ) : (
              <View style={{ marginTop: spacing.md }}>
                <Note tone="info">Closed {ticket.closedAt ? relative(ticket.closedAt) : ""}. Reopen it if the problem comes back.</Note>
                <Button title="Reopen" variant="secondary" icon="refresh-outline" onPress={() => run({ id, action: "reopen" }, "Reopened.")} loading={act.isPending} />
              </View>
            )}
          </>
        )}
      </Screen>
    </SafeAreaView>
  );
}
