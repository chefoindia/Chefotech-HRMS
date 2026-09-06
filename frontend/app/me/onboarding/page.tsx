"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PartyPopper } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate } from "@/lib/format";
import { Callout, Card, EmptyState, PageHeader, useToast } from "@/components/ui";
import { TaskList, ProgressBar } from "@/components/modules/TaskList";
import type { LifecycleTask, Onboarding } from "@/lib/lifecycleTypes";

/** The joiner's own view: their tasks, the welcome note, who their buddy is. */
export default function MyOnboardingPage() {
  const { session } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const locale = session?.organization?.locale || "en-IN";
  const { data, isLoading } = useQuery({ queryKey: ["onboarding", "me"], queryFn: async () => (await api.get<Onboarding | null>("/onboarding/me")).data });
  const complete = useMutation({
    mutationFn: ({ task, input }: { task: LifecycleTask; input: { status: "done" | "skipped"; note: string } }) => api.post(`/onboarding/${data!.id}/tasks/${task.id}/complete`, input),
    onSuccess: () => { toast.success("Done"); queryClient.invalidateQueries({ queryKey: ["onboarding", "me"] }); },
    onError: (error) => toast.fromError(error, "Could not mark that done."),
  });

  return (
    <>
      <PageHeader title="Getting started" description="Your first days: what to do, and what is being arranged for you." />
      {isLoading ? (
        <div className="skeleton h-40" />
      ) : !data ? (
        <Card><EmptyState icon={<PartyPopper className="h-6 w-6" />} title="Nothing to do here" description="Your joining checklist is complete, or HR has not opened one." /></Card>
      ) : (
        <div className="space-y-5">
          {data.welcomeNote && <Callout tone="info" title={`Welcome to ${session?.organization?.name || "the team"}`}>{data.welcomeNote}</Callout>}
          <Card>
            <p className="text-[13.5px] text-[var(--text-muted)]">
              Joining {data.joiningDate ? formatDate(data.joiningDate, { locale }) : "—"}
              {data.buddy ? ` · your buddy is ${data.buddy.name}` : ""}
            </p>
            <div className="mt-3"><ProgressBar {...data.progress} /></div>
            <div className="mt-4">
              <TaskList tasks={data.tasks} locale={locale} canComplete={() => true} busy={complete.isPending} onComplete={(task, input) => complete.mutate({ task, input: { status: input.status, note: input.note } })} />
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
