"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, AlertTriangle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button, Callout } from "@/components/ui";
import type { FormDraft } from "@/lib/formSchema";

/**
 * "Describe it and I'll fill it in."
 *
 * Sits at the top of a form and writes the person's sentence into the real
 * inputs below, where they read it, change what they disagree with, and press
 * Save themselves. Nothing here saves anything: the values go through the same
 * form, the same validation and the same permission check as anything typed by
 * hand, which is what makes it safe to let it fill a payroll component.
 *
 * The visible reporting matters as much as the filling. A draft that quietly
 * dropped a value the schema refused would be worse than one that never ran —
 * the person would look at a form that seems complete and save a record
 * missing the one field they actually cared about. So anything refused is
 * named, and anything still required is listed.
 */
export function AiFill({
  entity,
  current,
  onFilled,
  disabled,
}: {
  entity: string;
  current: Record<string, unknown>;
  onFilled: (values: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState<FormDraft | null>(null);

  const fill = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<FormDraft>(`/ai/forms/${entity}/draft`, {
        instruction,
        // Sent so the model changes only what was asked for, rather than
        // rewriting fields the person already filled in themselves.
        current,
      });
      return data;
    },
    onSuccess: (data) => {
      setDraft(data);
      onFilled(data.values);
    },
  });

  // The AI module is optional and per-organization. Where it is not set up the
  // endpoint says so, and this collapses to nothing rather than showing a
  // control that cannot work.
  const notConfigured = fill.error instanceof ApiError && fill.error.code === "AI_NOT_CONFIGURED";
  if (notConfigured) return null;

  const submit = () => {
    if (instruction.trim().length >= 3 && !fill.isPending) fill.mutate();
  };

  return (
    <div className="sm:col-span-2">
      <div className="rounded-[var(--radius)] border border-brand-100 bg-brand-50/50 p-3">
        <label
          htmlFor={`ai-fill-${entity}`}
          className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-brand-700"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Describe it and I&rsquo;ll fill it in
        </label>

        <div className="flex gap-2">
          <input
            id={`ai-fill-${entity}`}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                // The form's own Save is elsewhere; Enter here means "fill",
                // which is what someone who just typed a sentence expects.
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Night shift, 10pm to 6am, 45 minute unpaid break"
            className="input-base flex-1"
            disabled={disabled || fill.isPending}
          />
          <Button
            onClick={submit}
            loading={fill.isPending}
            disabled={disabled || instruction.trim().length < 3}
            icon={<Sparkles className="h-4 w-4" />}
          >
            Fill in
          </Button>
        </div>

        {fill.error && !notConfigured && (
          <p className="mt-2 text-[12.5px] text-[var(--danger)]">
            {fill.error instanceof ApiError ? fill.error.message : "Could not draft this. Try rephrasing."}
          </p>
        )}

        {draft?.explanation && !fill.isPending && (
          <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--text-muted)]">{draft.explanation}</p>
        )}
      </div>

      {draft && (draft.rejected.length > 0 || draft.missingRequired.length > 0) && !fill.isPending && (
        <Callout tone="warning" className="mt-2">
          <span className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {draft.rejected.length > 0 && (
                <>
                  Not filled in, because the value was not valid for the field:{" "}
                  <strong>{draft.rejected.map((r) => r.field).join(", ")}</strong>.{" "}
                </>
              )}
              {draft.missingRequired.length > 0 && (
                <>
                  Still needs a value: <strong>{draft.missingRequired.join(", ")}</strong>.
                </>
              )}
            </span>
          </span>
        </Callout>
      )}
    </div>
  );
}
