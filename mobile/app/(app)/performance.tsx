import { useState } from "react";
import { RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { format } from "date-fns";
import { useAcknowledgeReview, useMyGoals, useMyReviews, useSubmitSelfReview, useUpdateGoalProgress, type GoalItem, type ReviewItem } from "../../src/api/hooks";
import { ApiError } from "../../src/api/client";
import { useColors } from "../../src/theme/ThemeProvider";
import { Badge, Button, Card, Divider, EmptyState, ErrorState, Field, Loading, Screen, SectionHeader, Txt } from "../../src/components/ui";
import { Chips, ScreenHeader } from "../../src/components/ScreenHeader";
import { radius, spacing } from "../../src/theme";
import { useToast } from "../../src/components/Toast";

const STATUS_LABEL: Record<ReviewItem["status"], string> = { pending_self: "Self-review due", pending_manager: "With your manager", completed: "Ready to read", acknowledged: "Acknowledged" };
const STATUS_TONE: Record<ReviewItem["status"], "neutral" | "success" | "warning" | "danger" | "info"> = { pending_self: "warning", pending_manager: "info", completed: "success", acknowledged: "neutral" };

/** My goals and my reviews. */
export default function Performance() {
  const colors = useColors();
  const goals = useMyGoals();
  const reviews = useMyReviews();
  const refreshing = goals.isRefetching || reviews.isRefetching;
  const refetch = () => {
    goals.refetch();
    reviews.refetch();
  };

  const active = (goals.data || []).filter((g) => g.status === "active");
  const finished = (goals.data || []).filter((g) => g.status !== "active");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceMuted }} edges={["top"]}>
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} tintColor={colors.brand[600]} />}>
        <ScreenHeader title="My performance" />

        <SectionHeader title="Reviews" />
        {reviews.isLoading ? (
          <Loading />
        ) : reviews.isError ? (
          <ErrorState message={(reviews.error as Error).message} onRetry={reviews.refetch} />
        ) : !reviews.data?.length ? (
          <Card style={{ marginBottom: spacing.lg }}>
            <Txt variant="caption" tone="muted">
              No reviews yet. When HR starts a review cycle you are part of, it appears here.
            </Txt>
          </Card>
        ) : (
          reviews.data.map((review) => <ReviewCard key={review.id} review={review} />)
        )}

        <SectionHeader title="Goals" />
        {goals.isLoading ? (
          <Loading />
        ) : goals.isError ? (
          <ErrorState message={(goals.error as Error).message} onRetry={goals.refetch} />
        ) : !goals.data?.length ? (
          <EmptyState icon="flag-outline" title="No goals yet" body="Agree a few with your manager on the web portal; progress can be updated from here." />
        ) : (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {[...active, ...finished].map((goal, index) => (
              <View key={goal.id}>
                {index > 0 && <Divider />}
                <GoalRow goal={goal} />
              </View>
            ))}
          </Card>
        )}
      </Screen>
    </SafeAreaView>
  );
}

function Bar({ value }: { value: number }) {
  const colors = useColors();
  return (
    <View style={{ height: 6, borderRadius: radius.full, backgroundColor: colors.border, overflow: "hidden", marginTop: 6 }}>
      <View style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: "100%", backgroundColor: value >= 100 ? colors.success : colors.brand[600] }} />
    </View>
  );
}

function GoalRow({ goal }: { goal: GoalItem }) {
  const toast = useToast();
  const update = useUpdateGoalProgress();
  const [editing, setEditing] = useState(false);
  const [progress, setProgress] = useState(String(goal.progress));
  const [note, setNote] = useState("");

  const save = async () => {
    const n = Math.max(0, Math.min(100, Number(progress) || 0));
    try {
      await update.mutateAsync({ id: goal.id, progress: n, note });
      toast.success(n >= 100 ? "Goal completed." : "Progress saved.");
      setEditing(false);
      setNote("");
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Could not save progress.");
    }
  };

  return (
    <View style={{ paddingVertical: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Txt variant="bodyMedium" style={{ flex: 1 }} numberOfLines={2}>
          {goal.title}
        </Txt>
        {goal.status === "completed" ? <Badge label="Done" tone="success" /> : goal.status === "cancelled" ? <Badge label="Cancelled" tone="neutral" /> : <Txt variant="bodyMedium">{goal.progress}%</Txt>}
      </View>
      <Txt variant="caption" tone="muted" style={{ marginTop: 3 }}>
        {goal.metric ? `${goal.metric}${goal.target ? ` → ${goal.target}` : ""} · ` : ""}weight {goal.weight}
        {goal.dueDate ? ` · due ${format(new Date(goal.dueDate), "d MMM yyyy")}` : ""}
      </Txt>
      <Bar value={goal.progress} />
      {goal.status === "active" &&
        (editing ? (
          <View style={{ marginTop: spacing.md }}>
            <Field label="Progress (0 to 100)" keyboardType="number-pad" value={progress} onChangeText={setProgress} />
            <Field label="What changed (optional)" value={note} onChangeText={setNote} multiline numberOfLines={2} style={{ minHeight: 56, textAlignVertical: "top" }} />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button title="Cancel" variant="secondary" size="sm" onPress={() => setEditing(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Save" size="sm" onPress={save} loading={update.isPending} />
              </View>
            </View>
          </View>
        ) : (
          <View style={{ marginTop: spacing.sm, alignSelf: "flex-start" }}>
            <Button title="Update progress" variant="ghost" size="sm" icon="trending-up-outline" onPress={() => setEditing(true)} />
          </View>
        ))}
    </View>
  );
}

function ReviewCard({ review }: { review: ReviewItem }) {
  const toast = useToast();
  const submitSelf = useSubmitSelfReview();
  const acknowledge = useAcknowledgeReview();
  const [open, setOpen] = useState(false);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [comment, setComment] = useState("");

  const sections = review.cycle.sections || [];
  const scale = review.cycle.ratingScale || 5;
  const rated = sections.filter((s) => s.rated);
  const complete = rated.every((s) => ratings[s.key]);

  const sendSelf = async () => {
    try {
      await submitSelf.mutateAsync({ id: review.id, ratings, answers });
      toast.success("Self-review submitted.");
      setOpen(false);
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Could not submit.");
    }
  };
  const ack = async () => {
    try {
      await acknowledge.mutateAsync({ id: review.id, comment });
      toast.success("Acknowledged.");
      setOpen(false);
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "Could not acknowledge.");
    }
  };

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Txt variant="heading">{review.cycle.name || "Review"}</Txt>
          <Txt variant="caption" tone="muted" style={{ marginTop: 3 }}>
            {review.reviewer?.name ? `Reviewer ${review.reviewer.name}` : "No reviewer yet"}
            {review.status === "pending_self" && review.cycle.selfDueAt ? ` · by ${format(new Date(review.cycle.selfDueAt), "d MMM")}` : ""}
          </Txt>
        </View>
        <Badge label={STATUS_LABEL[review.status]} tone={STATUS_TONE[review.status]} />
      </View>

      {!open ? (
        <View style={{ marginTop: spacing.md, alignSelf: "flex-start" }}>
          <Button title={review.status === "pending_self" ? "Write self-review" : review.status === "completed" ? "Read and acknowledge" : "View"} size="sm" variant={review.status === "pending_self" || review.status === "completed" ? "primary" : "secondary"} onPress={() => setOpen(true)} />
        </View>
      ) : (
        <View style={{ marginTop: spacing.md }}>
          {review.goals.length > 0 && (
            <View style={{ marginBottom: spacing.md }}>
              <Txt variant="caption" tone="muted" style={{ marginBottom: 4 }}>
                GOALS AT THE START OF THE CYCLE
              </Txt>
              {review.goals.map((g, i) => (
                <View key={i} style={{ marginBottom: 6 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Txt variant="caption" style={{ flex: 1 }} numberOfLines={1}>
                      {g.title}
                    </Txt>
                    <Txt variant="caption" tone="muted">
                      {g.progress}%
                    </Txt>
                  </View>
                  <Bar value={g.progress} />
                </View>
              ))}
            </View>
          )}

          {sections.map((section) => (
            <View key={section.key} style={{ marginBottom: spacing.md }}>
              <Txt variant="bodyMedium">{section.title}</Txt>
              {section.description ? (
                <Txt variant="caption" tone="muted" style={{ marginBottom: 6 }}>
                  {section.description}
                </Txt>
              ) : (
                <View style={{ height: 6 }} />
              )}
              {review.status === "pending_self" ? (
                <>
                  {section.rated && <Chips options={Array.from({ length: scale }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} value={ratings[section.key] ? String(ratings[section.key]) : ""} onChange={(v) => setRatings({ ...ratings, [section.key]: Number(v) })} />}
                  <Field value={answers[section.key] || ""} onChangeText={(v) => setAnswers({ ...answers, [section.key]: v })} placeholder="What went well, what did not, and why." multiline numberOfLines={3} style={{ minHeight: 70, textAlignVertical: "top" }} />
                </>
              ) : (
                <>
                  {review.self.submittedAt && (
                    <Txt variant="caption" tone="muted">
                      You: {section.rated && review.self.ratings[section.key] ? `${review.self.ratings[section.key]}/${scale} · ` : ""}
                      {review.self.answers[section.key] || "no comment"}
                    </Txt>
                  )}
                  {review.manager?.submittedAt && (
                    <Txt variant="caption" style={{ marginTop: 3 }}>
                      Manager: {section.rated && review.manager.ratings[section.key] ? `${review.manager.ratings[section.key]}/${scale} · ` : ""}
                      {review.manager.answers[section.key] || "no comment"}
                    </Txt>
                  )}
                </>
              )}
            </View>
          ))}

          {review.manager?.submittedAt && (
            <View style={{ marginBottom: spacing.md }}>
              <Txt variant="bodyMedium">
                Overall: {review.manager.overallRating}/{scale}
              </Txt>
              {review.manager.summary ? (
                <Txt variant="caption" style={{ marginTop: 3 }}>
                  {review.manager.summary}
                </Txt>
              ) : null}
            </View>
          )}

          {review.status === "pending_self" && (
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button title="Later" variant="secondary" onPress={() => setOpen(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Submit" onPress={sendSelf} loading={submitSelf.isPending} disabled={!complete} />
              </View>
            </View>
          )}
          {review.status === "completed" && (
            <>
              <Field label="Your comment (optional)" value={comment} onChangeText={setComment} multiline numberOfLines={2} style={{ minHeight: 56, textAlignVertical: "top" }} />
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button title="Close" variant="secondary" onPress={() => setOpen(false)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Acknowledge" onPress={ack} loading={acknowledge.isPending} />
                </View>
              </View>
            </>
          )}
          {(review.status === "pending_manager" || review.status === "acknowledged") && (
            <View style={{ alignSelf: "flex-start" }}>
              <Button title="Close" variant="secondary" size="sm" onPress={() => setOpen(false)} />
            </View>
          )}
        </View>
      )}
    </Card>
  );
}
