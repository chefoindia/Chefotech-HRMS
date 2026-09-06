"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Send } from "lucide-react";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { Badge, Button, Callout, Drawer, EmptyState, PageLoader, Textarea, useToast } from "@/components/ui";
import { ProgressBar, RatingButtons } from "./EngagementBits";
import { REVIEW_STATUS_LABELS, type CycleSection, type Review } from "@/lib/engagementTypes";

/**
 * One review, from either chair.
 *
 * mode "subject": the employee — writes the self-review while it is due,
 * reads the manager's view once complete, acknowledges with a comment.
 * mode "reviewer": the manager (or HR) — sees the self-review beside the
 * form, rates each section, gives an overall rating and a summary.
 */
export function ReviewDrawer({ reviewId, mode, onClose }: { reviewId: string; mode: "subject" | "reviewer"; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: review, isLoading } = useQuery({
    queryKey: ["performance", "review", reviewId],
    queryFn: async () => (await api.get<Review>(`/performance/reviews/${reviewId}`)).data,
  });

  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [overall, setOverall] = useState<number | null>(null);
  const [summary, setSummary] = useState("");
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!review) return;
    if (mode === "subject" && review.status === "pending_self") {
      setRatings(review.self.ratings || {});
      setAnswers(review.self.answers || {});
    }
    if (mode === "reviewer" && review.manager) {
      setRatings(review.manager.ratings || {});
      setAnswers(review.manager.answers || {});
      setOverall(review.manager.overallRating);
      setSummary(review.manager.summary || "");
    }
  }, [review, mode]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["performance"] });
  };

  const submitSelf = useMutation({
    mutationFn: async () => api.post(`/performance/reviews/${reviewId}/self`, { ratings, answers }),
    onSuccess: () => {
      toast.success("Self-review submitted", "Your manager has been told.");
      invalidate();
      onClose();
    },
    onError: (error) => toast.fromError(error, "Could not submit your self-review."),
  });

  const submitManager = useMutation({
    mutationFn: async () => api.post(`/performance/reviews/${reviewId}/manager`, { ratings, answers, overallRating: overall, summary }),
    onSuccess: () => {
      toast.success("Review completed", "The employee has been told and can now read it.");
      invalidate();
      onClose();
    },
    onError: (error) => toast.fromError(error, "Could not complete the review."),
  });

  const acknowledge = useMutation({
    mutationFn: async () => api.post(`/performance/reviews/${reviewId}/acknowledge`, { comment }),
    onSuccess: () => {
      toast.success("Acknowledged");
      invalidate();
      onClose();
    },
    onError: (error) => toast.fromError(error, "Could not acknowledge the review."),
  });

  const sections: CycleSection[] = review?.cycle.sections || [];
  const scale = review?.cycle.ratingScale || 5;
  const writingSelf = mode === "subject" && review?.status === "pending_self";
  const writingManager = mode === "reviewer" && (review?.status === "pending_manager" || review?.status === "pending_self");
  const ratedSections = sections.filter((s) => s.rated);
  const selfComplete = ratedSections.every((s) => ratings[s.key]);
  const managerComplete = selfComplete && overall !== null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={review ? `${review.cycle.name || "Review"}${mode === "reviewer" && review.employee?.name ? `: ${review.employee.name}` : ""}` : "Review"}
      description={review ? `${REVIEW_STATUS_LABELS[review.status]}${review.cycle.periodStart ? ` · ${formatDate(review.cycle.periodStart)} to ${formatDate(review.cycle.periodEnd)}` : ""}` : undefined}
      width="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {writingSelf && (
            <Button icon={<Send className="h-3.5 w-3.5" />} disabled={!selfComplete} loading={submitSelf.isPending} onClick={() => submitSelf.mutate()}>
              Submit self-review
            </Button>
          )}
          {writingManager && (
            <Button icon={<Send className="h-3.5 w-3.5" />} disabled={!managerComplete} loading={submitManager.isPending} onClick={() => submitManager.mutate()}>
              Complete review
            </Button>
          )}
          {mode === "subject" && review?.status === "completed" && (
            <Button icon={<CheckCircle2 className="h-3.5 w-3.5" />} loading={acknowledge.isPending} onClick={() => acknowledge.mutate()}>
              Acknowledge
            </Button>
          )}
        </>
      }
    >
      {isLoading || !review ? (
        <PageLoader label="Loading review" />
      ) : (
        <div className="space-y-6">
          {writingSelf && <Callout tone="info">Rate each area honestly and add a few lines. Your manager sees this before writing theirs.</Callout>}
          {mode === "reviewer" && review.status === "pending_self" && review.cycle.status === "self_review" && <Callout tone="warning">The self-review has not been submitted yet. HR can move the cycle on if it is overdue.</Callout>}

          {review.goals.length > 0 && (
            <section>
              <h4 className="text-[13.5px] font-semibold text-[var(--text)]">Goals at the start of the cycle</h4>
              <ul className="mt-2 space-y-2">
                {review.goals.map((g, i) => (
                  <li key={i}>
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="text-[var(--text)]">{g.title}</span>
                      <span className="tabular text-[var(--text-muted)]">
                        {g.progress}% · weight {g.weight}
                      </span>
                    </div>
                    <ProgressBar value={g.progress} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {sections.map((section) => (
            <section key={section.key} className="rounded-lg border border-[var(--border)] p-3">
              <h4 className="text-[13.5px] font-semibold text-[var(--text)]">{section.title}</h4>
              {section.description && <p className="text-[12.5px] text-[var(--text-muted)]">{section.description}</p>}

              {/* The employee's side */}
              <div className="mt-3">
                <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Self-review</p>
                {writingSelf ? (
                  <div className="mt-1 space-y-2">
                    {section.rated && <RatingButtons value={ratings[section.key] ?? null} max={scale} onChange={(n) => setRatings({ ...ratings, [section.key]: n })} />}
                    <Textarea rows={3} value={answers[section.key] || ""} onChange={(e) => setAnswers({ ...answers, [section.key]: e.target.value })} placeholder="What went well, what did not, and why." />
                  </div>
                ) : review.self.submittedAt ? (
                  <ReadOnly rating={section.rated ? review.self.ratings[section.key] : undefined} scale={scale} text={review.self.answers[section.key]} />
                ) : (
                  <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">Not submitted.</p>
                )}
              </div>

              {/* The manager's side */}
              {(mode === "reviewer" || review.manager) && (
                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Manager review</p>
                  {writingManager ? (
                    <div className="mt-1 space-y-2">
                      {section.rated && <RatingButtons value={ratings[section.key] ?? null} max={scale} onChange={(n) => setRatings({ ...ratings, [section.key]: n })} />}
                      <Textarea rows={3} value={answers[section.key] || ""} onChange={(e) => setAnswers({ ...answers, [section.key]: e.target.value })} placeholder="Specific examples beat adjectives." />
                    </div>
                  ) : review.manager?.submittedAt ? (
                    <ReadOnly rating={section.rated ? review.manager.ratings[section.key] : undefined} scale={scale} text={review.manager.answers[section.key]} />
                  ) : (
                    <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">Not written yet.</p>
                  )}
                </div>
              )}
            </section>
          ))}

          {(writingManager || review.manager?.submittedAt) && (
            <section className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
              <h4 className="text-[13.5px] font-semibold text-[var(--text)]">Overall</h4>
              {writingManager ? (
                <div className="mt-2 space-y-3">
                  <RatingButtons value={overall} max={scale} onChange={setOverall} lowLabel="Needs improvement" highLabel="Outstanding" />
                  <Textarea label="Summary" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="The two or three things that define this period, and what to focus on next." />
                </div>
              ) : (
                <div className="mt-2">
                  <div className="flex items-center gap-2">
                    <Badge tone="brand">
                      {review.manager?.overallRating} of {scale}
                    </Badge>
                    {review.manager?.submittedAt && <span className="text-[12px] text-[var(--text-muted)]">{formatDateTime(review.manager.submittedAt)}</span>}
                  </div>
                  {review.manager?.summary && <p className="mt-2 whitespace-pre-wrap text-[13px] text-[var(--text)]">{review.manager.summary}</p>}
                </div>
              )}
            </section>
          )}

          {mode === "subject" && review.status === "completed" && <Textarea label="Your comment (optional)" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything you want on record alongside this review." />}
          {review.status === "acknowledged" && (
            <section>
              <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Acknowledged {review.acknowledgedAt ? formatDateTime(review.acknowledgedAt) : ""}</p>
              {review.employeeComment ? <p className="mt-1 whitespace-pre-wrap text-[13px] text-[var(--text)]">{review.employeeComment}</p> : <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">No comment added.</p>}
            </section>
          )}
          {mode === "reviewer" && !review.employee && <EmptyState title="No employee" description="This review has no subject." />}
        </div>
      )}
    </Drawer>
  );
}

function ReadOnly({ rating, scale, text }: { rating?: number; scale: number; text?: string }) {
  return (
    <div className="mt-1 space-y-1.5">
      {rating !== undefined && <RatingButtons value={rating ?? null} max={scale} size="sm" disabled />}
      {text ? <p className="whitespace-pre-wrap text-[13px] text-[var(--text)]">{text}</p> : <p className="text-[12.5px] text-[var(--text-muted)]">No comment.</p>}
    </div>
  );
}
