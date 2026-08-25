"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, Check, ChevronRight, Code2, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { Callout, Input, Select, Textarea } from "@/components/ui";
import {
  ALL_SYSTEM_VARIABLES,
  PAYROLL_RECIPES,
  RECIPES_BY_ID,
  SYSTEM_VARIABLE_GROUPS,
  type PayrollRecipe,
} from "@/content/payrollRecipes";

/**
 * Builds a salary formula without anyone typing one.
 *
 * The admin picks the shape of the calculation in plain English, fills the
 * blanks from dropdowns and number boxes, and reads a worked example in
 * rupees before saving. The generated expression is shown but not editable —
 * it is an output, not an input.
 *
 * A raw-expression escape hatch stays available for the genuinely bespoke
 * case, but it is deliberately behind a toggle so it is never where someone
 * starts.
 */
export function FormulaBuilder({
  value,
  componentCodes,
  onChange,
}: {
  value: string;
  componentCodes: Array<{ code: string; name: string }>;
  onChange: (expression: string) => void;
}) {
  const [mode, setMode] = useState<"guided" | "advanced">("guided");
  const [recipeId, setRecipeId] = useState<string>("");
  const [slots, setSlots] = useState<Record<string, string>>({});

  const recipe: PayrollRecipe | undefined = recipeId ? RECIPES_BY_ID[recipeId] : undefined;

  // Seed the slots with the recipe's own defaults whenever a new shape is
  // chosen, so the worked example below is never blank on first render.
  useEffect(() => {
    if (!recipe) return;
    setSlots((current) => {
      const next: Record<string, string> = {};
      for (const slot of recipe.slots) {
        next[slot.key] = current[slot.key] ?? String(slot.default ?? "");
      }
      return next;
    });
  }, [recipe]);

  const generated = useMemo(() => (recipe ? recipe.build(slots) : ""), [recipe, slots]);
  const worked = useMemo(() => (recipe ? recipe.worked(slots) : null), [recipe, slots]);

  // Push the generated expression up as soon as it is complete, so the
  // surrounding form saves exactly what the preview showed.
  useEffect(() => {
    if (mode === "guided" && generated) onChange(generated);
  }, [mode, generated, onChange]);

  const variableOptions = useMemo(
    () => [
      ...ALL_SYSTEM_VARIABLES.map((v) => ({ value: v.code, label: `${v.label} (${v.code})` })),
      ...componentCodes.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` })),
    ],
    [componentCodes]
  );

  return (
    <div className="space-y-4 sm:col-span-2">
      <div className="flex gap-1 rounded-md border p-0.5">
        <ModeTab active={mode === "guided"} onClick={() => setMode("guided")} icon={<Calculator className="h-3.5 w-3.5" />}>
          Build it step by step
        </ModeTab>
        <ModeTab active={mode === "advanced"} onClick={() => setMode("advanced")} icon={<Code2 className="h-3.5 w-3.5" />}>
          Write it myself
        </ModeTab>
      </div>

      {mode === "guided" ? (
        <>
          <Select
            label="What kind of calculation is this?"
            value={recipeId}
            onChange={(event) => {
              setRecipeId(event.target.value);
              setSlots({});
            }}
            placeholder="Choose the shape of the calculation…"
            options={PAYROLL_RECIPES.map((r) => ({ value: r.id, label: r.title }))}
          />

          {recipe && (
            <>
              <p className="rounded-md bg-[var(--surface-muted)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
                <span className="font-medium text-[var(--text)]">{recipe.summary}</span>{" "}
                Commonly used for: {recipe.usedFor}
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                {recipe.slots.map((slot) => {
                  const shared = {
                    key: slot.key,
                    label: slot.label,
                    hint: slot.hint,
                    value: slots[slot.key] ?? "",
                    onChange: (event: { target: { value: string } }) =>
                      setSlots((current) => ({ ...current, [slot.key]: event.target.value })),
                  };

                  if (slot.kind === "component") {
                    // Free text is still allowed here because the "whatever is
                    // left over" recipe legitimately takes a comma-separated
                    // list, which a single-select cannot express.
                    return slot.hint?.includes("comma") ? (
                      <Input {...shared} placeholder="BASIC, HRA" />
                    ) : (
                      <Select {...shared} options={variableOptions} placeholder="Choose a line…" />
                    );
                  }

                  return (
                    <Input
                      {...shared}
                      type="number"
                      min={0}
                      step={slot.kind === "percent" ? "0.01" : "1"}
                      prefix={slot.kind === "money" ? <span className="text-[13px]">₹</span> : undefined}
                      suffix={slot.kind === "percent" ? <span className="text-[13px]">%</span> : undefined}
                    />
                  );
                })}
              </div>

              {worked && (
                <div className="rounded-md border border-brand-100 bg-brand-50/60 p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700">
                    <Lightbulb className="h-3 w-3" aria-hidden />
                    What this pays
                  </p>
                  <p className="text-[12.5px] leading-relaxed text-[var(--text)]">{worked}</p>
                </div>
              )}

              {generated && (
                <div className="rounded-md border bg-[var(--surface-muted)] p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                    <Check className="h-3 w-3 text-[var(--success)]" aria-hidden />
                    Saved as
                  </p>
                  <code className="break-all font-mono text-[12px] text-[var(--text)]">{generated}</code>
                  <p className="mt-1.5 text-[11.5px] text-[var(--text-subtle)]">
                    Generated from your choices above — you never have to type this.
                  </p>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <Callout tone="warning">
            Only use this if the guided options genuinely cannot express what you need. A formula
            typed by hand is rejected on save if it does not parse, but a formula that parses and is
            still <em>wrong</em> will quietly pay the wrong amount to everyone on it.
          </Callout>

          <Textarea
            label="Formula"
            rows={3}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="min(pct(BASIC, 12), 1800)"
            className="font-mono text-[12.5px]"
          />

          <VariableReference componentCodes={componentCodes} />
        </>
      )}
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-[12.5px] font-medium transition-colors",
        active ? "bg-brand-600 text-white" : "text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/** The names a hand-written formula may use, so nothing has to be guessed. */
function VariableReference({ componentCodes }: { componentCodes: Array<{ code: string; name: string }> }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] font-medium text-[var(--text)]"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} aria-hidden />
        Names you can use in a formula
      </button>

      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          {SYSTEM_VARIABLE_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.variables.map((variable) => (
                  <li key={variable.code} className="text-[12px] leading-relaxed">
                    <code className="font-mono text-brand-700">{variable.code}</code>{" "}
                    <span className="text-[var(--text-muted)]">— {variable.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {componentCodes.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                Your own components
              </p>
              <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                {componentCodes.map((c) => c.code).join(", ")}
              </p>
              <p className="mt-1 text-[11.5px] text-[var(--text-subtle)]">
                A component can only reference ones calculated before it — check the order number.
              </p>
            </div>
          )}

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
              Functions
            </p>
            <ul className="space-y-0.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
              <li><code className="font-mono text-brand-700">pct(value, percent)</code> — a percentage of something</li>
              <li><code className="font-mono text-brand-700">min(a, b)</code> — the smaller of two, for a ceiling</li>
              <li><code className="font-mono text-brand-700">max(a, b)</code> — the larger of two, for a floor</li>
              <li><code className="font-mono text-brand-700">clamp(value, low, high)</code> — keep between two limits</li>
              <li><code className="font-mono text-brand-700">if(test, then, else)</code> — a condition</li>
              <li><code className="font-mono text-brand-700">round(value, digits)</code> — rounding</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
