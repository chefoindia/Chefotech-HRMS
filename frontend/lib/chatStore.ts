"use client";

import { useSyncExternalStore } from "react";
import { api } from "./api";

/**
 * The setup-guide chatbot's conversation state.
 *
 * A tiny external store, same pattern as tour-store — the launcher button, the
 * panel, and (eventually) a "the chatbot can help with this" prompt on an
 * error state all need to read and open the same conversation. There is no
 * server-side memory: every request sends the transcript already on screen,
 * matching how every other AI feature in this codebase works.
 */

export interface ChatAction {
  type: "navigate" | "start_tour";
  route?: string;
  tourId?: string;
  title?: string;
  prefill?: Record<string, string>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  actions?: ChatAction[];
  /** True only for a message the user hasn't seen the actions of yet — drives the "ran" affordance. */
  pending?: boolean;
}

export interface ChatState {
  open: boolean;
  messages: ChatMessage[];
  sending: boolean;
  error: string | null;
}

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text:
    "Hi — I can help you find or change anything in here, or guide you through setting up your organization from scratch. Try \"guide me through setup\" or ask for something specific, like \"change the office timings\".",
};

const initialState: ChatState = {
  open: false,
  messages: [WELCOME],
  sending: false,
  error: null,
};

let state: ChatState = initialState;
let idCounter = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<ChatState>) {
  state = { ...state, ...patch };
  emit();
}

function nextId() {
  idCounter += 1;
  return `msg_${idCounter}`;
}

export const chatStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSnapshot() {
    return state;
  },

  open() {
    setState({ open: true });
  },

  close() {
    setState({ open: false });
  },

  toggle() {
    setState({ open: !state.open });
  },

  /**
   * Send a message and get back the assistant's reply plus any actions
   * (navigate / start_tour) for the caller to actually perform — this store
   * never touches the router or the tour engine itself, since it has no
   * access to either; ChatWidget does that with the return value.
   */
  async send(text: string, currentRoute: string): Promise<ChatAction[]> {
    const userMessage: ChatMessage = { id: nextId(), role: "user", text };
    const history = state.messages
      .filter((m) => m.id !== "welcome")
      .map((m) => ({ role: m.role, text: m.text }));

    setState({ messages: [...state.messages, userMessage], sending: true, error: null });

    try {
      const { data } = await api.post<{ reply: string; actions: ChatAction[] }>("/ai/chat", {
        message: text,
        history,
        route: currentRoute,
      });

      const assistantMessage: ChatMessage = {
        id: nextId(),
        role: "assistant",
        text:
          data.reply ||
          (data.actions?.length ? "Here you go." : "I'm not sure — could you rephrase that?"),
        actions: data.actions,
      };
      setState({ messages: [...state.messages, assistantMessage], sending: false });
      return data.actions || [];
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message?: unknown }).message)
          : "Something went wrong. Please try again.";
      setState({ sending: false, error: message });
      const assistantMessage: ChatMessage = {
        id: nextId(),
        role: "assistant",
        text: message,
      };
      setState({ messages: [...state.messages, assistantMessage] });
      return [];
    }
  },

  reset() {
    idCounter = 0;
    state = { ...initialState, messages: [WELCOME] };
    emit();
  },
};

export function useChat() {
  return useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot, () => initialState);
}
