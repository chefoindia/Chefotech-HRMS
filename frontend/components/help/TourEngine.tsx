"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, MousePointerClick, Sparkles, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";
import { currentStep, tourStore, useTour } from "@/lib/tour-store";

/**
 * The guided tour engine.
 *
 * This is not a tooltip carousel. It drives the actual application: it
 * navigates to the right screen, waits for the real element to exist,
 * spotlights it, asks the user for the value in plain language, writes that
 * value into the real form field, and only advances once the step's
 * completion condition is genuinely met.
 *
 * Two details make it work against a React app:
 *
 *   1. Setting `input.value` directly does not update React state — React
 *      tracks the value on the DOM node. The native setter has to be called
 *      and an input event dispatched, or the field visually changes and the
 *      form submits the old value.
 *
 *   2. Elements appear asynchronously (a modal opening, a query resolving), so
 *      every target is polled for rather than queried once. If it never
 *      appears, the engine says so instead of silently pointing at nothing.
 */

const POLL_INTERVAL_MS = 120;
const TARGET_TIMEOUT_MS = 8000;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function TourEngine() {
  const router = useRouter();
  const pathname = usePathname();
  const state = useTour();
  const step = currentStep(state);

  const [rect, setRect] = useState<Rect | null>(null);
  const [answer, setAnswer] = useState<string>("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);
  const targetRef = useRef<HTMLElement | null>(null);

  const active = state.status === "running" && Boolean(step);

  // ── Persist progress so a reload resumes rather than restarts ────────────
  useEffect(() => {
    if (!state.tour || state.status === "idle") return;

    api
      .post(`/help/tours/${state.tour.id}/progress`, {
        status: state.status === "completed" ? "completed" : "in_progress",
        currentStepIndex: state.stepIndex,
        answers: state.answers,
      })
      .catch(() => {
        // Progress is a convenience. Losing it must never interrupt the tour.
      });
  }, [state.tour, state.stepIndex, state.status, state.answers]);

  // ── Navigate when a step asks for a different screen ─────────────────────
  useEffect(() => {
    if (!active || !step) return;
    const destination = step.route;
    if (destination && pathname !== destination) router.push(destination);
  }, [active, step, pathname, router]);

  // ── Find and follow the target element ───────────────────────────────────
  const locate = useCallback(() => {
    if (!step?.target) {
      targetRef.current = null;
      setRect(null);
      return true;
    }

    const element = document.querySelector<HTMLElement>(step.target);
    if (!element) return false;

    targetRef.current = element;
    const box = element.getBoundingClientRect();
    setRect({
      top: box.top - 6,
      left: box.left - 6,
      width: box.width + 12,
      height: box.height + 12,
    });
    return true;
  }, [step]);

  useEffect(() => {
    if (!active) return;

    setAnswer("");
    setValidationError(null);
    tourStore.setStuck(null);

    let elapsed = 0;
    let found = false;

    const timer = setInterval(() => {
      if (locate()) {
        if (!found) {
          found = true;
          targetRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        // Keep following: the page can scroll, a table can re-render, a
        // sidebar can expand underneath the highlight.
        return;
      }

      elapsed += POLL_INTERVAL_MS;
      if (elapsed >= TARGET_TIMEOUT_MS && !found) {
        tourStore.setStuck(
          "That control is not on screen. It may be hidden behind a filter, or you may not have permission to use it."
        );
        clearInterval(timer);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [active, step, locate, pathname]);

  useEffect(() => {
    if (!active) return;
    const onChange = () => locate();
    window.addEventListener("scroll", onChange, true);
    window.addEventListener("resize", onChange);
    return () => {
      window.removeEventListener("scroll", onChange, true);
      window.removeEventListener("resize", onChange);
    };
  }, [active, locate]);

  // ── Load options for a select step ───────────────────────────────────────
  useEffect(() => {
    if (!active || !step?.optionsFrom) {
      setOptions(step?.options?.map((o) => ({ value: String(o.value), label: o.label })) || []);
      return;
    }

    let cancelled = false;
    api
      .get<Array<Record<string, unknown>>>(step.optionsFrom, { query: { limit: 100 } })
      .then(({ data }) => {
        if (cancelled) return;
        setOptions(
          (data || []).map((row) => ({
            value: String(row.id || row._id || row.key || ""),
            label: String(row.name || row.label || row.title || row.key || ""),
          }))
        );
      })
      .catch(() => setOptions([]));

    return () => {
      cancelled = true;
    };
  }, [active, step]);

  // ── Watch for the step's completion condition ────────────────────────────
  useEffect(() => {
    if (!active || !step) return;
    if (!["urlMatches", "elementVisible", "elementGone"].includes(step.completeWhen)) return;

    const check = () => {
      if (step.completeWhen === "urlMatches") {
        const expected = step.completeRoute || step.route;
        if (expected && (pathname === expected || pathname.startsWith(expected))) {
          tourStore.next();
        }
        return;
      }

      if (step.completeWhen === "elementVisible" && step.completeTarget) {
        if (document.querySelector(step.completeTarget)) tourStore.next();
        return;
      }

      if (step.completeWhen === "elementGone" && step.completeTarget) {
        if (!document.querySelector(step.completeTarget)) tourStore.next();
      }
    };

    // A short delay stops "elementGone" firing before the element has even
    // been rendered for the first time.
    const timer = setTimeout(() => {
      check();
      const interval = setInterval(check, 250);
      return () => clearInterval(interval);
    }, 400);

    const interval = setInterval(check, 250);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [active, step, pathname]);

  // ── Apply an answer to the real form field ───────────────────────────────
  const applyAnswer = useCallback(() => {
    if (!step) return;

    const error = validate(step, answer);
    if (error) {
      setValidationError(error);
      return;
    }

    const element = targetRef.current;
    if (element) {
      setNativeValue(element, answer);
      element.focus();
    }

    if (step.field) tourStore.answer(step.field, answer);
    setAnswer("");
    setValidationError(null);
    tourStore.next();
  }, [step, answer]);

  const stepCount = state.tour?.steps?.length || 0;
  const progress = stepCount ? Math.round(((state.stepIndex + 1) / stepCount) * 100) : 0;

  const panelPosition = useMemo(() => computePanelPosition(rect), [rect]);

  if (typeof document === "undefined") return null;

  // ── Completed ────────────────────────────────────────────────────────────
  if (state.status === "completed" && state.tour) {
    return createPortal(
      <div className="fixed bottom-6 right-6 z-[80] w-80 animate-in rounded-[var(--radius)] border bg-[var(--surface)] p-5 shadow-2xl">
        <div className="mb-2 grid h-9 w-9 place-items-center rounded-full bg-[var(--success-bg)] text-[var(--success)]">
          <Check className="h-5 w-5" aria-hidden />
        </div>
        <h3 className="text-[15px] font-semibold text-[var(--text)]">
          {state.tour.title} — done
        </h3>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          You can run this walkthrough again any time from the help menu.
        </p>
        <Button className="mt-3" size="sm" fullWidth onClick={() => tourStore.stop()}>
          Finish
        </Button>
      </div>,
      document.body
    );
  }

  if (!active || !step) return null;

  const needsInput = step.action === "input" || step.action === "select" || step.action === "toggle";

  return createPortal(
    <>
      {rect && <div className="tour-spotlight" style={rect} aria-hidden />}

      {/* Dim the page even when there is no target to spotlight. */}
      {!rect && <div className="fixed inset-0 z-[55] bg-slate-900/50" aria-hidden />}

      <div
        role="dialog"
        aria-label={`${state.tour?.title}: ${step.title}`}
        className="animate-in fixed z-[65] w-[22rem] max-w-[calc(100vw-2rem)] rounded-[var(--radius)] border bg-[var(--surface)] shadow-2xl"
        style={panelPosition}
      >
        <div className="flex items-start gap-3 border-b px-4 py-3">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">
              {state.tour?.title}
            </p>
            <p className="text-[14px] font-semibold text-[var(--text)]">{step.title}</p>
          </div>
          <button
            type="button"
            onClick={() => tourStore.stop()}
            aria-label="End walkthrough"
            className="-mr-1 rounded p-1 text-[var(--text-subtle)] hover:bg-[var(--surface-sunken)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="px-4 py-3.5">
          {state.stuckOn ? (
            <p className="text-[13px] text-[var(--warning)]">{state.stuckOn}</p>
          ) : (
            <>
              {step.body && (
                <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">{step.body}</p>
              )}

              {step.action === "click" && !needsInput && (
                <p className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700">
                  <MousePointerClick className="h-4 w-4" aria-hidden />
                  Select the highlighted control to continue
                </p>
              )}

              {needsInput && (
                <div className="mt-3 space-y-2">
                  {step.ask && (
                    <p className="text-[13.5px] font-medium text-[var(--text)]">{step.ask}</p>
                  )}

                  {step.action === "input" ? (
                    <input
                      autoFocus
                      value={answer}
                      onChange={(event) => {
                        setAnswer(event.target.value);
                        setValidationError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          applyAnswer();
                        }
                      }}
                      type={inputTypeFor(step)}
                      placeholder={step.placeholder}
                      aria-invalid={validationError ? "true" : undefined}
                      className="input-base"
                    />
                  ) : (
                    <select
                      autoFocus
                      value={answer}
                      onChange={(event) => {
                        setAnswer(event.target.value);
                        setValidationError(null);
                      }}
                      className="input-base cursor-pointer"
                    >
                      <option value="">Choose…</option>
                      {options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}

                  {validationError && (
                    <p className="text-[12.5px] text-[var(--danger)]">{validationError}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t bg-[var(--surface-muted)] px-4 py-2.5">
          <div className="flex-1">
            <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="h-full rounded-full bg-brand-600 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-subtle)]">
              Step {state.stepIndex + 1} of {stepCount}
            </p>
          </div>

          {state.stepIndex > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => tourStore.back()}
              icon={<ArrowLeft className="h-3.5 w-3.5" />}
            >
              Back
            </Button>
          )}

          {needsInput ? (
            <Button size="sm" onClick={applyAnswer} iconRight={<ArrowRight className="h-3.5 w-3.5" />}>
              Fill in
            </Button>
          ) : step.completeWhen === "manual" || state.stuckOn ? (
            <Button size="sm" onClick={() => tourStore.next()} iconRight={<ArrowRight className="h-3.5 w-3.5" />}>
              {state.stepIndex + 1 >= stepCount ? "Finish" : "Next"}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => tourStore.next()}>
              Skip
            </Button>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function inputTypeFor(step: { validate?: { type?: string } }) {
  const type = step.validate?.type;
  if (type === "number") return "number";
  if (type === "date") return "date";
  if (type === "time") return "time";
  if (type === "email") return "email";
  return "text";
}

function validate(step: { validate?: { type?: string; required?: boolean; min?: number; max?: number; message?: string } }, value: string) {
  const rules = step.validate;
  if (!rules) return null;

  if (rules.required && !value.trim()) return rules.message || "This is required.";
  if (!value.trim()) return null;

  if (rules.type === "number") {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return rules.message || "Enter a number.";
    if (rules.min !== undefined && numeric < rules.min) {
      return rules.message || `Enter at least ${rules.min}.`;
    }
    if (rules.max !== undefined && numeric > rules.max) {
      return rules.message || `Enter at most ${rules.max}.`;
    }
    return null;
  }

  if (rules.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return rules.message || "Enter a valid email address.";
  }

  if (rules.type === "time" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return rules.message || "Use the format HH:mm.";
  }

  if (rules.min !== undefined && value.length < rules.min) {
    return rules.message || `Enter at least ${rules.min} characters.`;
  }
  if (rules.max !== undefined && value.length > rules.max) {
    return rules.message || `Enter at most ${rules.max} characters.`;
  }

  return null;
}

/**
 * Write a value into a React-controlled field.
 *
 * Assigning `element.value` updates the DOM but not React's state, because
 * React caches the last value it wrote on the node. Calling the prototype's
 * native setter first clears that cache, and the dispatched event then runs
 * the component's onChange exactly as a keystroke would.
 */
function setNativeValue(element: HTMLElement, value: string) {
  const isSelect = element instanceof HTMLSelectElement;
  const prototype = isSelect
    ? window.HTMLSelectElement.prototype
    : element instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;

  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  if (setter) {
    setter.call(element, value);
  } else {
    (element as HTMLInputElement).value = value;
  }

  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Keep the panel next to the highlight, and always inside the viewport. */
function computePanelPosition(rect: Rect | null): React.CSSProperties {
  const PANEL_WIDTH = 352;
  const PANEL_HEIGHT = 280;
  const MARGIN = 16;

  if (!rect) {
    return { bottom: "2rem", left: "50%", transform: "translateX(-50%)" };
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const spaceBelow = viewportHeight - (rect.top + rect.height);
  const spaceRight = viewportWidth - (rect.left + rect.width);

  // Prefer the right of the target, then below, then above.
  if (spaceRight > PANEL_WIDTH + MARGIN) {
    return {
      left: Math.min(rect.left + rect.width + MARGIN, viewportWidth - PANEL_WIDTH - MARGIN),
      top: clamp(rect.top, MARGIN, Math.max(MARGIN, viewportHeight - PANEL_HEIGHT - MARGIN)),
    };
  }

  if (spaceBelow > PANEL_HEIGHT + MARGIN) {
    return {
      top: rect.top + rect.height + MARGIN,
      left: clamp(rect.left, MARGIN, Math.max(MARGIN, viewportWidth - PANEL_WIDTH - MARGIN)),
    };
  }

  return {
    bottom: MARGIN,
    left: clamp(rect.left, MARGIN, Math.max(MARGIN, viewportWidth - PANEL_WIDTH - MARGIN)),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
