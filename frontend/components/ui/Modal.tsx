"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

/**
 * Modals and drawers.
 *
 * Both trap focus, close on Escape, restore focus to whatever opened them, and
 * lock body scroll. Rolled by hand rather than pulled from a library because
 * the behaviour is small, and a dialog that loses keyboard focus is unusable
 * for the payroll team who work almost entirely from the keyboard.
 */

function useDialogBehaviour(open: boolean, onClose: () => void) {
  const contentRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Every caller passes an inline `onClose={() => setX(null)}`, so its
  // identity changes on every render of the parent — including the render
  // that typing a single character into a field inside the dialog causes.
  // A ref absorbs that churn without it being a dependency below, so the
  // effect's setup/teardown (and the 20ms auto-focus timer inside it) only
  // ever runs when the dialog actually opens or closes, not on every
  // keystroke. Previously `onClose` was a dependency, so every keystroke
  // re-ran the effect and re-armed the timer, which refocused the dialog's
  // first focusable element — the close button — out from under whatever
  // field the person was typing into.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;

    document.body.style.overflow = "hidden";
    // Compensate for the removed scrollbar so the page does not jump.
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    const focusable =
      'a[href], button:not([disabled]), textarea, input:not([type="hidden"]), select, [tabindex]:not([tabindex="-1"])';

    const timer = setTimeout(() => {
      const first = contentRef.current?.querySelector<HTMLElement>(focusable);
      (first || contentRef.current)?.focus();
    }, 20);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !contentRef.current) return;

      const elements = Array.from(contentRef.current.querySelectorAll<HTMLElement>(focusable)).filter(
        (element) => element.offsetParent !== null
      );
      if (!elements.length) return;

      const first = elements[0];
      const last = elements[elements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  return contentRef;
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const SIZES = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
};

export function Modal({ open, onClose, title, description, children, footer, size = "md", className }: ModalProps) {
  const contentRef = useDialogBehaviour(open, onClose);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />

      <div className="flex min-h-full items-end justify-center p-0 sm:items-center sm:p-4">
        <div
          ref={contentRef}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === "string" ? title : undefined}
          tabIndex={-1}
          className={cn(
            "animate-in relative w-full bg-[var(--surface)] shadow-xl",
            "rounded-t-[var(--radius)] sm:rounded-[var(--radius)]",
            SIZES[size],
            className
          )}
        >
          {(title || description) && (
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <div className="min-w-0">
                {title && <h2 className="text-[15px] font-semibold text-[var(--text)]">{title}</h2>}
                {description && (
                  <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">{description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 -mt-1 rounded p-1.5 text-[var(--text-subtle)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
              >
                <X className="h-4.5 w-4.5" aria-hidden />
              </button>
            </div>
          )}

          <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>

          {footer && (
            <div className="flex items-center justify-end gap-2 border-t bg-[var(--surface-muted)] px-5 py-3">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
}: Omit<ModalProps, "size"> & { width?: "sm" | "md" | "lg" }) {
  const contentRef = useDialogBehaviour(open, onClose);

  if (!open || typeof document === "undefined") return null;

  const widths = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-2xl" };

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />

      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        className={cn(
          "absolute inset-y-0 right-0 flex w-full flex-col bg-[var(--surface)] shadow-2xl",
          widths[width]
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-[var(--text)]">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded p-1.5 text-[var(--text-subtle)] hover:bg-[var(--surface-sunken)]"
          >
            <X className="h-4.5 w-4.5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t bg-[var(--surface-muted)] px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  loading,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3.5">
        {tone === "danger" && (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--danger-bg)] text-[var(--danger)]">
            <AlertTriangle className="h-4.5 w-4.5" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-[var(--text)]">{title}</h2>
          <div className="mt-1 text-[13.5px] text-[var(--text-muted)]">{message}</div>
        </div>
      </div>
    </Modal>
  );
}
