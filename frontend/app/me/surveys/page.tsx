"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MessageSquareText, Send } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate } from "@/lib/format";
import { Badge, Button, Callout, Card, Checkbox, EmptyState, Modal, PageHeader, PageLoader, Textarea, useToast } from "@/components/ui";
import { RatingButtons } from "@/components/modules/EngagementBits";
import type { Survey, SurveyAnswer, SurveyQuestion } from "@/lib/engagementTypes";

/** Surveys sent to me. Answer once; anonymous ones never record who. */
export default function MySurveysPage() {
  const { session, can } = useSession();
  const locale = session?.organization?.locale || "en-IN";
  const [answering, setAnswering] = useState<Survey | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["surveys", "mine"],
    queryFn: async () => (await api.get<Survey[]>("/surveys/me")).data,
    enabled: can("survey.respond") && Boolean(session?.employeeId),
  });

  if (!can("survey.respond")) return <EmptyState icon={<MessageSquareText className="h-5 w-5" />} title="Surveys are not enabled for you" description="Ask HR if you think you should be seeing them." />;

  const rows = data || [];
  const waiting = rows.filter((s) => !s.responded);
  const done = rows.filter((s) => s.responded);

  return (
    <>
      <PageHeader title="Surveys" description="Short questionnaires from HR. A few minutes each, and the honest answer is the useful one." />

      {isLoading ? (
        <PageLoader label="Loading surveys" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<MessageSquareText className="h-5 w-5" />} title="No open surveys" description="When HR sends one, it appears here and in your notifications." />
      ) : (
        <div className="space-y-5">
          {waiting.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {waiting.map((s) => (
                <Card key={s.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-[var(--text)]">{s.title}</p>
                      {s.description && <p className="mt-1 text-[13px] text-[var(--text-muted)]">{s.description}</p>}
                      <p className="mt-2 text-[12.5px] text-[var(--text-muted)]">
                        {s.questions.length} question{s.questions.length === 1 ? "" : "s"}
                        {s.closesAt ? ` · closes ${formatDate(s.closesAt, { locale })}` : ""}
                      </p>
                    </div>
                    {s.anonymous && <Badge tone="info">Anonymous</Badge>}
                  </div>
                  <div className="mt-4">
                    <Button icon={<Send className="h-3.5 w-3.5" />} onClick={() => setAnswering(s)}>
                      Answer
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
          {done.length > 0 && (
            <Card>
              <p className="text-[13.5px] font-medium text-[var(--text)]">Answered</p>
              <ul className="mt-2 divide-y divide-[var(--border)]">
                {done.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                    <span className="text-[var(--text)]">{s.title}</span>
                    <span className="flex items-center gap-1 text-[var(--success)]">
                      <CheckCircle2 className="h-4 w-4" /> Done
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {answering && <AnswerDialog survey={answering} onClose={() => setAnswering(null)} />}
    </>
  );
}

export function AnswerDialog({ survey, onClose }: { survey: Survey; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  const set = (id: string, value: unknown) => setAnswers((current) => ({ ...current, [id]: value }));

  const missing = survey.questions.filter((q) => q.required && isEmpty(answers[q.id]));

  const submit = useMutation({
    mutationFn: async () => {
      const payload: SurveyAnswer[] = survey.questions.map((q) => ({ questionId: q.id, value: answers[q.id] ?? null }));
      return api.post(`/surveys/me/${survey.id}/respond`, { answers: payload });
    },
    onSuccess: () => {
      toast.success("Thank you", survey.anonymous ? "Your answers were recorded anonymously." : "Your answers were recorded.");
      queryClient.invalidateQueries({ queryKey: ["surveys", "mine"] });
      onClose();
    },
    onError: (error) => toast.fromError(error, "Could not submit your answers."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={survey.title}
      description={survey.description || undefined}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Later
          </Button>
          <Button icon={<Send className="h-3.5 w-3.5" />} disabled={missing.length > 0} loading={submit.isPending} onClick={() => submit.mutate()}>
            Submit
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {survey.anonymous ? <Callout tone="info">This survey is anonymous. Nobody, including HR, can see who gave which answer.</Callout> : <Callout tone="warning">Your name is recorded with your answers.</Callout>}
        {survey.questions.map((q, i) => (
          <div key={q.id}>
            <p className="text-[13.5px] font-medium text-[var(--text)]">
              {i + 1}. {q.prompt}
              {q.required && <span className="text-[var(--danger)]"> *</span>}
            </p>
            {q.help && <p className="text-[12.5px] text-[var(--text-muted)]">{q.help}</p>}
            <div className="mt-2">
              <QuestionInput question={q} value={answers[q.id]} onChange={(v) => set(q.id, v)} />
            </div>
          </div>
        ))}
        {missing.length > 0 && <p className="text-[12.5px] text-[var(--text-muted)]">{missing.length} required question{missing.length === 1 ? "" : "s"} left.</p>}
      </div>
    </Modal>
  );
}

function isEmpty(v: unknown) {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function QuestionInput({ question, value, onChange }: { question: SurveyQuestion; value: unknown; onChange: (v: unknown) => void }) {
  switch (question.type) {
    case "rating":
    case "scale":
      return <RatingButtons value={typeof value === "number" ? value : null} max={question.max} onChange={onChange} lowLabel={question.lowLabel} highLabel={question.highLabel} />;
    case "yes_no":
      return (
        <div className="flex gap-2">
          {[
            [true, "Yes"],
            [false, "No"],
          ].map(([v, label]) => (
            <Button key={String(v)} variant={value === v ? "primary" : "outline"} size="sm" onClick={() => onChange(v)}>
              {label as string}
            </Button>
          ))}
        </div>
      );
    case "single":
      return (
        <div className="flex flex-wrap gap-2">
          {question.options.map((o) => (
            <Button key={o} variant={value === o ? "primary" : "outline"} size="sm" onClick={() => onChange(o)}>
              {o}
            </Button>
          ))}
        </div>
      );
    case "multi": {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="grid gap-1 sm:grid-cols-2">
          {question.options.map((o) => (
            <Checkbox key={o} label={o} checked={chosen.includes(o)} onChange={(e) => onChange(e.target.checked ? [...chosen, o] : chosen.filter((c) => c !== o))} />
          ))}
        </div>
      );
    }
    default:
      return <Textarea rows={3} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} placeholder="Your answer" />;
  }
}
