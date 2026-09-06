"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Bell, ChevronDown, ChevronUp, Lock, MessageSquareText, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, formatRelative } from "@/lib/format";
import { Badge, Button, Callout, Checkbox, ConfirmDialog, Drawer, EmptyState, FieldGrid, Input, Modal, NoAccessState, PageHeader, PageLoader, Select, Switch, Tabs, Textarea, useToast } from "@/components/ui";
import { AudienceFields, DistributionBars } from "@/components/modules/EngagementBits";
import { EMPTY_AUDIENCE, QUESTION_TYPES, type Audience, type QuestionType, type Survey, type SurveyQuestion, type SurveyResults } from "@/lib/engagementTypes";

/**
 * Surveys for HR: build, open, remind, close, read the results.
 */
export default function SurveysPage() {
  const { session, can } = useSession();
  const locale = session?.organization?.locale || "en-IN";
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("open");
  const [editing, setEditing] = useState<Survey | "new" | null>(null);
  const [results, setResults] = useState<Survey | null>(null);
  const [confirm, setConfirm] = useState<{ survey: Survey; action: "open" | "close" | "delete" } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["surveys", "all"],
    queryFn: async () => (await api.get<Survey[]>("/surveys")).data,
    enabled: can("survey.manage"),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["surveys"] });

  const act = useMutation({
    mutationFn: async ({ survey, action }: { survey: Survey; action: "open" | "close" | "delete" | "remind" }) => {
      if (action === "delete") return api.delete(`/surveys/${survey.id}`);
      const { data: result } = await api.post<{ reminded?: number }>(`/surveys/${survey.id}/${action}`);
      return result;
    },
    onSuccess: (result, { action, survey }) => {
      if (action === "open") toast.success("Survey opened", `${survey.title} was sent to its audience.`);
      else if (action === "close") toast.success("Survey closed", "Results are final.");
      else if (action === "remind") toast.success("Reminders sent", `${(result as { reminded?: number })?.reminded ?? 0} people nudged.`);
      else toast.success("Survey deleted");
      setConfirm(null);
      invalidate();
    },
    onError: (error) => toast.fromError(error, "That did not work."),
  });

  if (!can("survey.manage")) return <NoAccessState what="surveys" />;

  const rows = data || [];
  const shown = rows.filter((s) => s.status === tab);
  const tabs = [
    { key: "open", label: "Open", count: rows.filter((s) => s.status === "open").length },
    { key: "draft", label: "Drafts", count: rows.filter((s) => s.status === "draft").length },
    { key: "closed", label: "Closed", count: rows.filter((s) => s.status === "closed").length },
  ];

  return (
    <>
      <PageHeader
        title="Surveys"
        description="Pulse checks, engagement surveys, quick polls. Anonymous by default, one answer per person."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>
            New survey
          </Button>
        }
      />
      <Tabs items={tabs} active={tab} onChange={setTab} className="mb-5" />

      {isLoading ? (
        <PageLoader label="Loading surveys" />
      ) : shown.length === 0 ? (
        <EmptyState icon={<MessageSquareText className="h-5 w-5" />} title={tab === "draft" ? "No drafts" : tab === "open" ? "Nothing open right now" : "No closed surveys yet"} description="Create one, add a few questions, and open it to an audience." action={<Button onClick={() => setEditing("new")}>New survey</Button>} />
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          {shown.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[14px] font-medium text-[var(--text)]">{s.title}</p>
                  {s.anonymous ? <Badge tone="info">Anonymous</Badge> : <Badge tone="neutral">Named</Badge>}
                </div>
                <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">
                  {s.questions.length} question{s.questions.length === 1 ? "" : "s"} · {describeAudience(s.audience)}
                  {s.status !== "draft" && ` · ${s.respondedCount} of ${s.invitedCount} answered (${s.rate}%)`}
                  {s.closesAt && s.status === "open" ? ` · closes ${formatDate(s.closesAt, { locale })}` : ""}
                  {s.status === "closed" && s.closedAt ? ` · closed ${formatRelative(s.closedAt)}` : ""}
                  {s.createdBy ? ` · by ${s.createdBy}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                {s.status === "draft" && (
                  <>
                    <Button variant="ghost" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" icon={<Play className="h-3.5 w-3.5" />} onClick={() => setConfirm({ survey: s, action: "open" })}>
                      Open
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Delete survey" onClick={() => setConfirm({ survey: s, action: "delete" })}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
                {s.status === "open" && (
                  <>
                    <Button variant="ghost" size="sm" icon={<Bell className="h-3.5 w-3.5" />} loading={act.isPending && act.variables?.survey.id === s.id && act.variables?.action === "remind"} onClick={() => act.mutate({ survey: s, action: "remind" })}>
                      Remind
                    </Button>
                    <Button variant="ghost" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" icon={<Square className="h-3.5 w-3.5" />} onClick={() => setConfirm({ survey: s, action: "close" })}>
                      Close
                    </Button>
                  </>
                )}
                {s.status !== "draft" && (
                  <Button variant="outline" size="sm" icon={<BarChart3 className="h-3.5 w-3.5" />} onClick={() => setResults(s)}>
                    Results
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <SurveyBuilder
          survey={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}
      {results && <ResultsDrawer survey={results} onClose={() => setResults(null)} />}

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) act.mutate(confirm);
        }}
        loading={act.isPending}
        tone={confirm?.action === "delete" ? "danger" : "primary"}
        title={confirm?.action === "open" ? `Open "${confirm.survey.title}"?` : confirm?.action === "close" ? `Close "${confirm?.survey.title}"?` : `Delete "${confirm?.survey.title}"?`}
        confirmLabel={confirm?.action === "open" ? "Open and notify" : confirm?.action === "close" ? "Close" : "Delete"}
        message={
          confirm?.action === "open"
            ? "Everyone in the audience is notified now. Questions and anonymity are locked once open."
            : confirm?.action === "close"
              ? "No more answers are accepted. Results become final."
              : "The draft and its questions are removed."
        }
      />
    </>
  );
}

function describeAudience(a: Audience) {
  if (a.type === "department") return "one department";
  if (a.type === "location") return "one location";
  if (a.type === "employees") return `${a.employeeIds.length} chosen people`;
  return "everyone";
}

type DraftQuestion = Omit<SurveyQuestion, "id"> & { id?: string; optionsText?: string };

function SurveyBuilder({ survey, onClose, onSaved }: { survey: Survey | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const locked = survey?.status === "open";
  const [title, setTitle] = useState(survey?.title || "");
  const [description, setDescription] = useState(survey?.description || "");
  const [anonymous, setAnonymous] = useState(survey ? survey.anonymous : true);
  const [closesAt, setClosesAt] = useState(survey?.closesAt ? survey.closesAt.slice(0, 10) : "");
  const [audience, setAudience] = useState<Audience>(survey?.audience || EMPTY_AUDIENCE);
  const [questions, setQuestions] = useState<DraftQuestion[]>(
    survey?.questions.map((q) => ({ ...q, optionsText: q.options.join(", ") })) || [{ type: "rating", prompt: "", help: "", options: [], required: true, max: 5, lowLabel: "", highLabel: "", optionsText: "" }]
  );

  const setQ = (i: number, patch: Partial<DraftQuestion>) => setQuestions((current) => current.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  const move = (i: number, dir: -1 | 1) =>
    setQuestions((current) => {
      const next = [...current];
      const j = i + dir;
      if (j < 0 || j >= next.length) return current;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const valid = title.trim().length > 0 && questions.length > 0 && questions.every((q) => q.prompt.trim() && (!["single", "multi"].includes(q.type) || (q.optionsText || "").split(",").filter((o) => o.trim()).length >= 2));

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title: title.trim(),
        description: description.trim(),
        anonymous,
        closesAt: closesAt || null,
        audience,
        ...(locked
          ? {}
          : {
              questions: questions.map((q) => ({
                id: q.id,
                type: q.type,
                prompt: q.prompt.trim(),
                help: q.help,
                options: (q.optionsText || "")
                  .split(",")
                  .map((o) => o.trim())
                  .filter(Boolean),
                required: q.required,
                max: q.max,
                lowLabel: q.lowLabel,
                highLabel: q.highLabel,
              })),
            }),
      };
      if (survey) return api.patch(`/surveys/${survey.id}`, locked ? { title: body.title, description: body.description, closesAt: body.closesAt, audience: body.audience } : body);
      return api.post("/surveys", body);
    },
    onSuccess: () => {
      toast.success(survey ? "Survey saved" : "Draft created", survey ? undefined : "Open it when you are ready to send.");
      onSaved();
    },
    onError: (error) => toast.fromError(error, "Could not save the survey."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={survey ? `Edit: ${survey.title}` : "New survey"}
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            {survey ? "Save" : "Create draft"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <FieldGrid columns={2}>
          <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="How are we doing this quarter?" />
          <Input label="Closes on (optional)" type="date" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} hint="People are reminded two days before, and it closes itself." />
        </FieldGrid>
        <Textarea label="Introduction (optional)" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Why you are asking, and what you will do with the answers." />
        <Switch label="Anonymous" hint={locked ? "Fixed once a survey is open." : "Nobody can see who gave which answer. Recommended for anything about managers, workload or wellbeing."} checked={anonymous} onChange={setAnonymous} disabled={locked} />
        <AudienceFields value={audience} onChange={setAudience} />

        <div>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[var(--text)]">Questions</p>
            {!locked && (
              <Button variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setQuestions([...questions, { type: "rating", prompt: "", help: "", options: [], required: true, max: 5, lowLabel: "", highLabel: "", optionsText: "" }])}>
                Add question
              </Button>
            )}
          </div>
          {locked && (
            <Callout tone="info" className="mt-2" icon={<Lock className="h-4 w-4" />}>
              Questions are locked while the survey is open, so answers keep lining up.
            </Callout>
          )}
          <div className="mt-3 space-y-3">
            {questions.map((q, i) => (
              <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-2 w-6 text-[12px] font-semibold text-[var(--text-muted)]">{i + 1}.</span>
                  <div className="flex-1 space-y-3">
                    <FieldGrid columns={3}>
                      <div className="sm:col-span-2">
                        <Input label="Question" value={q.prompt} onChange={(e) => setQ(i, { prompt: e.target.value })} disabled={locked} required />
                      </div>
                      <Select label="Type" value={q.type} onChange={(e) => setQ(i, { type: e.target.value as QuestionType })} options={QUESTION_TYPES.map((t) => ({ value: t.value, label: t.label }))} disabled={locked} />
                    </FieldGrid>
                    {["single", "multi"].includes(q.type) && <Input label="Options" value={q.optionsText || ""} onChange={(e) => setQ(i, { optionsText: e.target.value })} placeholder="Office, Home, Mix" hint="Separate with commas. At least two." disabled={locked} />}
                    {["rating", "scale"].includes(q.type) && (
                      <FieldGrid columns={3}>
                        <Select label="Scale" value={String(q.max)} onChange={(e) => setQ(i, { max: Number(e.target.value) })} options={[3, 4, 5, 7, 10].map((n) => ({ value: String(n), label: `1 to ${n}` }))} disabled={locked} />
                        <Input label="Low label" value={q.lowLabel} onChange={(e) => setQ(i, { lowLabel: e.target.value })} placeholder="Not at all" disabled={locked} />
                        <Input label="High label" value={q.highLabel} onChange={(e) => setQ(i, { highLabel: e.target.value })} placeholder="Completely" disabled={locked} />
                      </FieldGrid>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Checkbox label="Required" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} disabled={locked} />
                      {!locked && (
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label="Move down" disabled={i === questions.length - 1} onClick={() => move(i, 1)}>
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label="Remove question" disabled={questions.length === 1} onClick={() => setQuestions(questions.filter((_, idx) => idx !== i))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ResultsDrawer({ survey, onClose }: { survey: Survey; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["surveys", survey.id, "results"],
    queryFn: async () => (await api.get<SurveyResults>(`/surveys/${survey.id}/results`)).data,
  });

  return (
    <Drawer open onClose={onClose} title={`Results: ${survey.title}`} description={data ? `${data.responded} of ${data.invited} answered (${data.rate}%)${survey.anonymous ? " · anonymous" : ""}` : undefined} width="lg">
      {isLoading || !data ? (
        <PageLoader label="Crunching answers" />
      ) : data.responded === 0 ? (
        <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No answers yet" description="Results appear as people respond." />
      ) : (
        <div className="space-y-6">
          {data.questions.map((q, i) => (
            <div key={q.id}>
              <p className="text-[13.5px] font-medium text-[var(--text)]">
                {i + 1}. {q.prompt}
              </p>
              <p className="text-[12px] text-[var(--text-muted)]">
                {q.answered} answer{q.answered === 1 ? "" : "s"}
                {typeof q.average === "number" ? ` · average ${q.average} of ${q.max}` : ""}
              </p>
              <div className="mt-2">
                {q.distribution && <DistributionBars counts={q.distribution} total={q.answered} />}
                {q.counts && <DistributionBars counts={q.counts} total={q.answered} />}
                {q.texts && (
                  <ul className="space-y-1.5">
                    {q.texts.map((t, idx) => (
                      <li key={idx} className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-[13px] text-[var(--text)]">
                        {t.text}
                        {t.by && <span className="ml-2 text-[12px] text-[var(--text-muted)]">— {t.by}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
          {data.respondents && (
            <div>
              <p className="text-[13.5px] font-medium text-[var(--text)]">Who answered</p>
              <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">{data.respondents.map((r) => r.name).join(", ")}</p>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
