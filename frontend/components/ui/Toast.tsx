"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";

type Tone = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  tone: Tone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  duration: number;
}

interface ToastContextValue {
  toast: (toast: Omit<Toast, "id" | "duration"> & { duration?: number }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  /** Turn a caught error into the right message without repeating this everywhere. */
  fromError: (error: unknown, fallback?: string) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<Tone, ReactNode> = {
  success: <CheckCircle2 className="h-4.5 w-4.5" aria-hidden />,
  error: <XCircle className="h-4.5 w-4.5" aria-hidden />,
  warning: <AlertTriangle className="h-4.5 w-4.5" aria-hidden />,
  info: <Info className="h-4.5 w-4.5" aria-hidden />,
};

const TONES: Record<Tone, string> = {
  success: "border-l-[var(--success)] text-[var(--success)]",
  error: "border-l-[var(--danger)] text-[var(--danger)]",
  warning: "border-l-[var(--warning)] text-[var(--warning)]",
  info: "border-l-[var(--info)] text-[var(--info)]",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback(
    ({ duration = 5000, ...rest }: Omit<Toast, "id" | "duration"> & { duration?: number }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Cap the stack: five toasts is already too many to read.
      setToasts((current) => [...current.slice(-4), { id, duration, ...rest }]);

      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  const fromError = useCallback(
    (error: unknown, fallback = "Something went wrong.") => {
      if (error instanceof ApiError) {
        const fieldErrors = Object.values(error.fieldErrors);
        toast({
          tone: error.isPermissionError || error.isPlanError ? "warning" : "error",
          title: error.message,
          description: fieldErrors.length ? fieldErrors.slice(0, 3).join(" · ") : undefined,
          duration: 7000,
        });
        return;
      }
      toast({
        tone: "error",
        title: error instanceof Error ? error.message : fallback,
        duration: 6000,
      });
    },
    [toast]
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      dismiss,
      fromError,
      success: (title, description) => toast({ tone: "success", title, description }),
      error: (title, description) => toast({ tone: "error", title, description, duration: 7000 }),
      warning: (title, description) => toast({ tone: "warning", title, description }),
      info: (title, description) => toast({ tone: "info", title, description }),
    }),
    [toast, dismiss, fromError]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted &&
        createPortal(
          <div
            className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0"
            role="region"
            aria-label="Notifications"
          >
            {toasts.map((item) => (
              <div
                key={item.id}
                role="status"
                aria-live="polite"
                className={cn(
                  "animate-in pointer-events-auto flex items-start gap-3 rounded-[var(--radius)] border border-l-4 bg-[var(--surface)] p-3.5 shadow-lg",
                  TONES[item.tone]
                )}
              >
                <span className="mt-0.5 shrink-0">{ICONS[item.tone]}</span>

                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-[var(--text)]">{item.title}</p>
                  {item.description && (
                    <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">{item.description}</p>
                  )}
                  {item.action && (
                    <button
                      type="button"
                      onClick={() => {
                        item.action?.onClick();
                        dismiss(item.id);
                      }}
                      className="mt-1.5 text-[12.5px] font-medium text-brand-600 hover:underline"
                    >
                      {item.action.label}
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  aria-label="Dismiss"
                  className="-mr-1 -mt-1 shrink-0 rounded p-1 text-[var(--text-subtle)] hover:bg-[var(--surface-sunken)]"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ))}
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside a ToastProvider");
  return context;
}
