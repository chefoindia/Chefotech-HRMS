"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock, PlayCircle, Search, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button, Drawer, EmptyState } from "@/components/ui";
import { tourStore } from "@/lib/tour-store";
import type { HelpMatch, Tour } from "@/lib/types";

/**
 * The help assistant.
 *
 * The user asks a question in their own words and gets two things back: a
 * direct answer, and — where one exists — a walkthrough that performs the task
 * with them rather than describing it.
 *
 * Matching happens on the server against a local intent index, with no
 * external AI call. That is deliberate: help has to work when a customer's
 * network blocks outbound traffic, when a key expires, and in an air-gapped
 * deployment. The structure is ready for a model to sit in front of it later,
 * mapping free text to the same intent ids.
 */
export function HelpAssistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [result, setResult] = useState<{
    matches: HelpMatch[];
    confident: boolean;
    fallback: string | null;
    aiAnswer: string | null;
  } | null>(null);
  const [asking, setAsking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: suggestions } = useQuery({
    queryKey: ["help", "suggestions"],
    queryFn: async () => {
      const { data } = await api.get<Array<{ intentId: string; question: string; tourId: string | null }>>(
        "/help/suggestions"
      );
      return data;
    },
    enabled: open,
    staleTime: 10 * 60_000,
  });

  const { data: tours } = useQuery({
    queryKey: ["help", "tours"],
    queryFn: async () => {
      const { data } = await api.get<Tour[]>("/help/tours");
      return data;
    },
    enabled: open,
    staleTime: 10 * 60_000,
  });

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
    else {
      setQuery("");
      setSubmitted("");
      setResult(null);
    }
  }, [open]);

  const ask = async (question: string) => {
    if (!question.trim()) return;
    setAsking(true);
    setSubmitted(question);

    try {
      const { data } = await api.post<{
        matches: HelpMatch[];
        confident: boolean;
        fallback: string | null;
        aiAnswer: string | null;
      }>("/help/ask", { query: question });
      setResult(data);
    } catch {
      setResult({
        matches: [],
        confident: false,
        fallback: "Help is not reachable right now. Please try again in a moment.",
        aiAnswer: null,
      });
    } finally {
      setAsking(false);
    }
  };

  const startTour = async (tourId: string) => {
    try {
      const { data } = await api.get<Tour>(`/help/tours/${tourId}`);
      tourStore.start(data);
      onClose();
    } catch {
      // If the tour cannot load, at least take them to the right screen.
      router.push("/app/settings");
      onClose();
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Help"
      description="Ask in your own words, and I will walk you through it."
      width="md"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          ask(query);
        }}
        className="relative"
      >
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-subtle)]"
          aria-hidden
        />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="How do I configure half day?"
          aria-label="Ask a question"
          className="input-base h-11 pl-9 pr-20"
        />
        <Button
          type="submit"
          size="sm"
          loading={asking}
          className="absolute right-1.5 top-1/2 -translate-y-1/2"
        >
          Ask
        </Button>
      </form>

      {/* ── Answer ─────────────────────────────────────────────────────── */}
      {result && (
        <div className="mt-5 space-y-3">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
            {submitted}
          </p>

          {result.matches.length === 0 && result.aiAnswer ? (
            <div className="rounded-[var(--radius)] border border-brand-200 bg-brand-50/50 p-4">
              <p className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-brand-700">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Answered by your AI assistant
              </p>
              <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-[var(--text)]">
                {result.aiAnswer}
              </p>
            </div>
          ) : result.matches.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="h-5 w-5" />}
              title="I could not find that"
              description={result.fallback || undefined}
              className="py-8"
            />
          ) : (
            result.matches.map((match, index) => (
              <div
                key={match.intentId}
                className={cn(
                  "rounded-[var(--radius)] border p-4",
                  index === 0 && result.confident
                    ? "border-brand-200 bg-brand-50/50"
                    : "bg-[var(--surface)]"
                )}
              >
                <p className="text-[13.5px] leading-relaxed text-[var(--text)]">{match.answer}</p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {match.tour && (
                    <Button
                      size="sm"
                      onClick={() => startTour(match.tour!.id)}
                      icon={<PlayCircle className="h-4 w-4" />}
                    >
                      Walk me through it
                    </Button>
                  )}
                  {match.route && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        router.push(match.route!);
                        onClose();
                      }}
                      iconRight={<ArrowRight className="h-3.5 w-3.5" />}
                    >
                      Take me there
                    </Button>
                  )}
                </div>

                {match.tour && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-[var(--text-subtle)]">
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                    {match.tour.stepCount} steps · about {match.tour.estimatedMinutes} minutes
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Suggestions ────────────────────────────────────────────────── */}
      {!result && (
        <>
          {suggestions && suggestions.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                Common questions
              </p>
              <div className="space-y-1">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.intentId}
                    type="button"
                    onClick={() => {
                      setQuery(suggestion.question);
                      ask(suggestion.question);
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-[13.5px] text-[var(--text)] hover:bg-[var(--surface-muted)]"
                  >
                    <span className="truncate">{suggestion.question}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-subtle)]" aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          )}

          {tours && tours.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                Guided walkthroughs
              </p>
              <div className="space-y-2">
                {tours.map((tour) => (
                  <button
                    key={tour.id}
                    type="button"
                    onClick={() => startTour(tour.id)}
                    className="flex w-full items-start gap-3 rounded-[var(--radius)] border p-3 text-left hover:border-brand-300 hover:bg-brand-50/40"
                  >
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700">
                      <PlayCircle className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-medium text-[var(--text)]">
                        {tour.title}
                      </span>
                      <span className="mt-0.5 block text-[12.5px] text-[var(--text-muted)]">
                        {tour.description}
                      </span>
                      <span className="mt-1 block text-[11.5px] text-[var(--text-subtle)]">
                        {tour.stepCount} steps · {tour.estimatedMinutes} min
                        {tour.status === "completed" && " · completed"}
                        {tour.status === "in_progress" && " · in progress"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
