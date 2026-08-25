"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUp, MapPin, MessageCircleQuestion, Sparkles, X } from "lucide-react";
import { api } from "@/lib/api";
import { chatStore, useChat, type ChatAction } from "@/lib/chatStore";
import { tourStore, useTour } from "@/lib/tour-store";
import type { Tour } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The setup guide — an always-available chat, docked in the corner of every
 * screen in the app.
 *
 * Its own job stops at deciding what to do and saying so. Doing it is always
 * handed to code that already exists and is already trusted: `router.push`
 * for navigation, and the guided-tour engine (the same one launched from the
 * help centre) for anything that highlights a field or writes a value — so a
 * value the chatbot "auto-fills" goes through exactly the same
 * look-then-confirm step a human-launched tour already requires.
 */
export function ChatWidget() {
  const router = useRouter();
  const pathname = usePathname();
  const chat = useChat();
  const tour = useTour();
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages, chat.sending]);

  // A running tour already has the user's full attention with its own
  // overlay — a second floating panel here would just be visual noise.
  if (tour.status === "running") return null;

  async function runAction(action: ChatAction) {
    if (action.type === "navigate" && action.route) {
      router.push(action.route);
      chatStore.close();
    } else if (action.type === "start_tour" && action.tourId) {
      try {
        const { data } = await api.get<Tour>(`/help/tours/${action.tourId}`);
        tourStore.start(data, action.prefill || {});
        chatStore.close();
      } catch {
        // The chatbot already named the destination in its reply, so a
        // failed tour fetch (permission changed, tour renamed) is not a dead
        // end — it just falls back to whatever text it already sent.
      }
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || chat.sending) return;
    setInput("");
    const actions = await chatStore.send(text, pathname);
    const primary = actions.find((a) => a.type === "navigate" || a.type === "start_tour");
    if (primary) await runAction(primary);
  }

  if (!chat.open) {
    return (
      <button
        type="button"
        onClick={() => chatStore.open()}
        aria-label="Open the setup guide"
        className="fixed bottom-5 right-5 z-40 flex h-13 items-center gap-2 rounded-full bg-brand-600 px-4 py-3.5 text-white shadow-xl transition-transform hover:scale-105 hover:bg-brand-700"
      >
        <Sparkles className="h-5 w-5" aria-hidden />
        <span className="hidden text-[13.5px] font-medium sm:inline">Ask setup guide</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 flex h-[32rem] w-[23rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-[var(--radius)] border bg-[var(--surface)] shadow-2xl">
      <div className="flex items-center gap-2.5 border-b bg-[var(--surface-muted)] px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-[var(--text)]">Setup guide</p>
          <p className="truncate text-[11.5px] text-[var(--text-subtle)]">
            Ask to be shown, guided, or taken anywhere
          </p>
        </div>
        <button
          type="button"
          onClick={() => chatStore.close()}
          aria-label="Close"
          className="rounded p-1.5 text-[var(--text-subtle)] hover:bg-[var(--surface-sunken)]"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3.5 py-4">
        {chat.messages.map((message) => (
          <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-[calc(var(--radius)-2px)] px-3 py-2 text-[13px] leading-relaxed",
                message.role === "user"
                  ? "bg-brand-600 text-white"
                  : "border bg-[var(--surface-muted)] text-[var(--text)]"
              )}
            >
              <p className="whitespace-pre-line">{message.text}</p>

              {message.actions && message.actions.length > 0 && (
                <div className="mt-2 space-y-1.5 border-t border-[var(--border)]/60 pt-2">
                  {message.actions.map((action, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => runAction(action)}
                      className="flex w-full items-center gap-1.5 rounded-md border bg-[var(--surface)] px-2.5 py-1.5 text-left text-[12px] font-medium text-brand-700 hover:bg-brand-50"
                    >
                      {action.type === "start_tour" ? (
                        <MessageCircleQuestion className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      ) : (
                        <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      )}
                      {action.type === "start_tour" ? `Walk me through: ${action.title}` : `Take me to ${action.title}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {chat.sending && (
          <div className="flex justify-start">
            <div className="rounded-[calc(var(--radius)-2px)] border bg-[var(--surface-muted)] px-3 py-2">
              <span className="flex gap-1">
                <Dot delay="0ms" />
                <Dot delay="120ms" />
                <Dot delay="240ms" />
              </span>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t p-3">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSubmit(event);
            }
          }}
          rows={1}
          placeholder="e.g. guide me through setup, or change office timings"
          className="input-base max-h-24 flex-1 resize-none py-2"
        />
        <button
          type="submit"
          disabled={!input.trim() || chat.sending}
          aria-label="Send"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white transition-opacity hover:bg-brand-700 disabled:opacity-40"
        >
          <ArrowUp className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-subtle)]"
      style={{ animationDelay: delay }}
      aria-hidden
    />
  );
}
