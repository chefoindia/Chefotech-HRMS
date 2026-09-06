import { useState } from "react";
import { RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { TASK_OWNER_LABELS, useCompleteOnboardingTask, useMyOnboarding, type LifecycleTask } from "../../src/api/hooks";
import { useSession } from "../../src/auth/session";
import { ApiError } from "../../src/api/client";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Loading, Screen, Txt } from "../../src/components/ui";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { Note } from "../../src/components/Sheet";
import { radius, spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";
import { dateLabel, relative } from "../../src/lib/format";

/** Getting started — the web portal's /me/onboarding: the joiner's own checklist. */
export default function OnboardingScreen() {
  const colors = useColors();
  const toast = useToast();
  const { session } = useSession();
  const query = useMyOnboarding();
  const complete = useCompleteOnboardingTask();
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const data = query.data;

  const finish = async (task: LifecycleTask, status: "done" | "skipped") => {
    if (!data) return;
    try {
      await complete.mutateAsync({ onboardingId: data.id, taskId: task.id, status, note });
      toast.success(status === "done" ? "Done." : "Skipped.");
      setOpen(null);
      setNote("");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not mark that done.");
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} tintColor={colors.brand[600]} />}>
        <ScreenHeader title="Getting started" />
        <Txt variant="caption" tone="muted" style={{ marginBottom: spacing.lg }}>
          Your first days: what to do, and what is being arranged for you.
        </Txt>

        {query.isLoading ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState message={query.error instanceof ApiError ? query.error.message : "Could not load this."} onRetry={query.refetch} />
        ) : !data ? (
          <Card>
            <EmptyState icon="sparkles-outline" title="Nothing to do here" body="Your joining checklist is complete, or HR has not opened one." />
          </Card>
        ) : (
          <>
            {data.welcomeNote ? (
              <Note tone="info">
                <Txt variant="label" style={{ marginBottom: 2 }}>
                  Welcome to {session?.organization?.name || "the team"}
                </Txt>
                <Txt variant="caption" style={{ lineHeight: 18 }}>
                  {data.welcomeNote}
                </Txt>
              </Note>
            ) : null}
            <Card>
              <Txt variant="body" tone="muted">
                Joining {data.joiningDate ? dateLabel(data.joiningDate) : "—"}
                {data.buddy ? ` · your buddy is ${data.buddy.name}` : ""}
              </Txt>
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.md, gap: spacing.md }}>
                <View style={{ flex: 1, height: 8, borderRadius: radius.full, backgroundColor: colors.surfaceSunken, overflow: "hidden" }}>
                  <View style={{ width: `${data.progress.percent}%`, height: "100%", backgroundColor: colors.success }} />
                </View>
                <Txt variant="caption" tone="muted">
                  {data.progress.done} / {data.progress.total}
                </Txt>
              </View>

              <View style={{ marginTop: spacing.lg }}>
                {data.tasks.map((task, index) => {
                  const done = task.status !== "pending";
                  return (
                    <View key={task.id} style={{ paddingVertical: spacing.md, borderTopWidth: index ? 1 : 0, borderTopColor: colors.border }}>
                      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
                        <Ionicons name={task.status === "done" ? "checkmark-circle" : task.status === "skipped" ? "remove-circle-outline" : "ellipse-outline"} size={20} color={task.status === "done" ? colors.success : colors.textSubtle} style={{ marginTop: 1 }} />
                        <View style={{ flex: 1 }}>
                          <Txt variant={done ? "body" : "bodyMedium"} tone={done ? "muted" : "default"} style={done ? { textDecorationLine: "line-through" } : undefined}>
                            {task.title}
                          </Txt>
                          <Txt variant="caption" tone="muted" style={{ marginTop: 2 }}>
                            {TASK_OWNER_LABELS[task.owner] || task.owner}
                            {task.assignee ? ` · ${task.assignee}` : ""}
                            {task.dueOn ? ` · due ${dateLabel(task.dueOn)}` : ""}
                            {done && task.completedAt ? ` · ${task.status} ${relative(task.completedAt)}${task.completedBy ? ` by ${task.completedBy}` : ""}` : ""}
                            {task.note ? ` — ${task.note}` : ""}
                          </Txt>
                          {task.description && !done ? (
                            <Txt variant="caption" tone="subtle" style={{ marginTop: 2 }}>
                              {task.description}
                            </Txt>
                          ) : null}
                        </View>
                        {task.isOverdue && !done && <Badge label="Overdue" tone="danger" />}
                      </View>
                      {!done && (
                        <View style={{ marginLeft: 28, marginTop: spacing.sm }}>
                          {open === task.id ? (
                            <>
                              <Field placeholder="Note (optional)" value={note} onChangeText={setNote} />
                              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                                <View style={{ flex: 1 }}>
                                  <Button title="Skip" variant="secondary" size="sm" onPress={() => finish(task, "skipped")} loading={complete.isPending} />
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Button title="Done" size="sm" onPress={() => finish(task, "done")} loading={complete.isPending} />
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Button title="Cancel" variant="ghost" size="sm" onPress={() => setOpen(null)} />
                                </View>
                              </View>
                            </>
                          ) : (
                            <View style={{ alignSelf: "flex-start" }}>
                              <Button title="Mark done" variant="secondary" size="sm" onPress={() => setOpen(task.id)} />
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </Card>
          </>
        )}
      </Screen>
    </SafeAreaView>
  );
}
