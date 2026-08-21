"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  PlayCircle,
  SkipForward,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { tourStore } from "@/lib/tour-store";
import { Button, Card, PageLoader, useToast } from "@/components/ui";
import type { OnboardingProgress, OnboardingStep, Tour } from "@/lib/types";

/**
 * First run.
 *
 * A checklist, not a wizard that blocks the product. Every step is skippable
 * and revisitable, and each one offers to walk the user through it rather than
 * dropping them on a settings screen and wishing them luck.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { session, loading } = useSession();

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  const { data, isLoading } = useQuery({
    queryKey: ["onboarding"],
    queryFn: async () => {
      const { data: payload } = await api.get<{
        steps: OnboardingStep[];
        progress: OnboardingProgress;
      }>("/organizations/current/onboarding");
      return payload;
    },
    enabled: Boolean(session),
  });

  const { data: tours } = useQuery({
    queryKey: ["help", "tours"],
    queryFn: async () => {
      const { data: payload } = await api.get<Tour[]>("/help/tours");
      return payload;
    },
    enabled: Boolean(session),
  });

  const setStatus = useMutation({
    mutationFn: async ({ step, status }: { step: string; status: string }) => {
      await api.post(`/organizations/current/onboarding/${step}`, { status });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["onboarding"] }),
    onError: (error) => toast.fromError(error, "Could not update that step."),
  });

  const startTour = async (tourId: string) => {
    try {
      const { data: tour } = await api.get<Tour>(`/help/tours/${tourId}`);
      tourStore.start(tour);
      router.push(tour.steps?.[0]?.route || "/app");
    } catch {
      router.push("/app");
    }
  };

  if (loading || isLoading) return <PageLoader label="Setting things up" />;
  if (!data) return null;

  const { steps, progress } = data;
  const tourFor = (stepKey: string) =>
    ({
      departments: "add_employee",
      employees: "add_employee",
      shifts: "create_shift",
      leave: "create_leave_policy",
      attendance: "configure_half_day",
      biometric: "connect_biometric_device",
      branding: "change_company_logo",
    })[stepKey];

  return (
    <div className="min-h-screen bg-[var(--surface-muted)] py-10">
      <div className="mx-auto max-w-3xl px-5">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-brand-100 text-brand-700">
            <Sparkles className="h-6 w-6" aria-hidden />
          </span>

          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">
            {progress.isComplete
              ? "You are all set up"
              : `Welcome to ${session?.organization?.name || "Chefotech HRMS"}`}
          </h1>
          <p className="mx-auto mt-2 max-w-lg text-[14.5px] text-[var(--text-muted)]">
            {progress.isComplete
              ? "Everything essential is configured. You can revisit any of this from Settings."
              : "Work through these when it suits you. The product is fully usable from right now — nothing here blocks you."}
          </p>

          <div className="mx-auto mt-5 max-w-sm">
            <div className="h-2 overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="h-full rounded-full bg-brand-600 transition-all duration-500"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="mt-2 text-[13px] text-[var(--text-muted)]">
              <span className="tabular font-semibold text-[var(--text)]">{progress.percent}%</span>{" "}
              · {progress.completedCount} of {progress.requiredCount} essential steps
            </p>
          </div>
        </div>

        <Card padded={false}>
          <ul className="divide-y">
            {steps.map((step) => {
              const done = step.status === "completed";
              const skipped = step.status === "skipped";
              const tourId = tourFor(step.key);
              const hasTour = tourId && tours?.some((tour) => tour.id === tourId);

              return (
                <li
                  key={step.key}
                  className={cn("flex flex-wrap items-center gap-4 p-4", (done || skipped) && "opacity-70")}
                >
                  {done ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--success)]" aria-hidden />
                  ) : skipped ? (
                    <SkipForward className="h-5 w-5 shrink-0 text-[var(--text-subtle)]" aria-hidden />
                  ) : (
                    <Circle className="h-5 w-5 shrink-0 text-[var(--text-subtle)]" aria-hidden />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-[var(--text)]">
                      {step.title}
                      {!step.required && (
                        <span className="ml-2 text-[11.5px] font-normal text-[var(--text-subtle)]">
                          optional
                        </span>
                      )}
                    </p>
                    <p className="text-[13px] text-[var(--text-muted)]">{step.description}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {hasTour && !done && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<PlayCircle className="h-3.5 w-3.5" />}
                        onClick={() => startTour(tourId!)}
                      >
                        Walk me through
                      </Button>
                    )}

                    {!done && !skipped && !step.required && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStatus.mutate({ step: step.key, status: "skipped" })}
                      >
                        Skip
                      </Button>
                    )}

                    <Link href={step.route}>
                      <Button variant={done ? "ghost" : "outline"} size="sm">
                        {done ? "Review" : "Open"}
                      </Button>
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-[var(--text-muted)]">
            You can pick this up any time from the banner on your dashboard.
          </p>
          <Link href="/app">
            <Button iconRight={<ArrowRight className="h-4 w-4" />}>
              {progress.isComplete ? "Go to the dashboard" : "Skip for now"}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
