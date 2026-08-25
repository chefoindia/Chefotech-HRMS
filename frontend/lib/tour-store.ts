"use client";

import { useSyncExternalStore } from "react";
import type { Tour, TourStep } from "./types";

/**
 * Tour state.
 *
 * A tiny external store rather than context, because the tour is started from
 * the help assistant, the help centre and the onboarding banner — three places
 * in different parts of the tree — and driven by a single overlay mounted in
 * the shell.
 */

export interface TourState {
  tour: Tour | null;
  stepIndex: number;
  answers: Record<string, unknown>;
  status: "idle" | "running" | "paused" | "completed";
  /** Set when a step's target cannot be found, so the overlay can explain. */
  stuckOn: string | null;
  /**
   * Values suggested by the AI chatbot, keyed by field name — pre-fills a
   * step's answer input but never applies it. The user still has to look at
   * the highlighted field and press "Fill in" themselves; this only saves
   * them typing a value they already told the chatbot in conversation.
   */
  prefill: Record<string, string>;
}

const initialState: TourState = {
  tour: null,
  stepIndex: 0,
  answers: {},
  status: "idle",
  stuckOn: null,
  prefill: {},
};

let state: TourState = initialState;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<TourState>) {
  state = { ...state, ...patch };
  emit();
}

export const tourStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSnapshot() {
    return state;
  },

  start(tour: Tour, prefill: Record<string, string> = {}) {
    setState({
      tour,
      // Resume where the user left off rather than restarting from step one.
      stepIndex: tour.status === "in_progress" ? tour.currentStepIndex || 0 : 0,
      answers: {},
      status: "running",
      stuckOn: null,
      prefill,
    });
  },

  next() {
    if (!state.tour) return;
    const nextIndex = state.stepIndex + 1;
    if (nextIndex >= (state.tour.steps?.length || 0)) {
      setState({ status: "completed", stuckOn: null });
      return;
    }
    setState({ stepIndex: nextIndex, stuckOn: null });
  },

  back() {
    setState({ stepIndex: Math.max(0, state.stepIndex - 1), stuckOn: null });
  },

  goTo(index: number) {
    setState({ stepIndex: index, stuckOn: null });
  },

  answer(field: string, value: unknown) {
    setState({ answers: { ...state.answers, [field]: value } });
  },

  setStuck(reason: string | null) {
    setState({ stuckOn: reason });
  },

  pause() {
    setState({ status: "paused" });
  },

  resume() {
    setState({ status: "running" });
  },

  stop() {
    state = initialState;
    emit();
  },
};

export function useTour() {
  return useSyncExternalStore(tourStore.subscribe, tourStore.getSnapshot, () => initialState);
}

export function currentStep(state: TourState): TourStep | null {
  if (!state.tour?.steps) return null;
  return state.tour.steps[state.stepIndex] || null;
}
