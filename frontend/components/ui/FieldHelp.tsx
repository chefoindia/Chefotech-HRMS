"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, Lightbulb, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The info icon that sits beside a configuration field.
 *
 * Settings screens are where an HR administrator makes decisions that quietly
 * change everyone's pay and attendance months later, usually without being
 * able to see the consequence at the moment they choose. A one-line hint is
 * not enough for that: this shows what the setting actually does downstream,
 * and a worked example with real values, so the effect of a choice is visible
 * before it is saved rather than discovered in a payroll dispute.
 *
 * Rendered in a portal and positioned against the trigger's viewport rect, so
 * it is never clipped by a card's `overflow-hidden` — which is what happens
 * to a plain absolutely-positioned popover inside these forms.
 */
export interface FieldHelpContent {
  why: string;
  example?: string | null;
}

export function FieldHelp({ label, help, className }: { label: string; help: FieldHelpContent; className?: string }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    const reposition = () => {
      if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
    };
    reposition();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    // Deferred so the click that opened the panel does not immediately close it.
    const timer = setTimeout(() => document.addEventListener("mousedown", onPointerDown), 0);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`What does "${label}" do?`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-grid h-4 w-4 shrink-0 place-items-center rounded-full align-middle transition-colors",
          open ? "text-brand-600" : "text-[var(--text-subtle)] hover:text-brand-600",
          className
        )}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>

      {open && rect && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={`About ${label}`}
            className="animate-in fixed z-[70] overflow-hidden rounded-[var(--radius)] border bg-[var(--surface)] shadow-2xl"
            // Width comes from the inline style rather than a `w-[21rem]` /
            // `max-w-[calc(100vw-2rem)]` class pair: a viewport-relative max
            // width collapses the panel to nothing wherever `100vw` resolves
            // to 0 (embedded webviews and headless browsers both do this),
            // and the same numbers are needed here anyway to keep the panel
            // on screen.
            style={panelPosition(rect)}
          >
            <div className="flex items-start gap-2 border-b bg-[var(--surface-muted)] px-3.5 py-2.5">
              <p className="min-w-0 flex-1 text-[13px] font-semibold text-[var(--text)]">{label}</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="-mr-1 -mt-0.5 rounded p-1 text-[var(--text-subtle)] hover:bg-[var(--surface-sunken)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>

            <div className="space-y-3 px-3.5 py-3">
              <p className="text-[12.5px] leading-relaxed text-[var(--text-muted)]">{help.why}</p>

              {help.example && (
                <div className="rounded-md border border-brand-100 bg-brand-50/60 p-2.5">
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700">
                    <Lightbulb className="h-3 w-3" aria-hidden />
                    For example
                  </p>
                  <p className="text-[12.5px] leading-relaxed text-[var(--text)]">{help.example}</p>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

/** Keep the panel beside its icon and always fully inside the viewport. */
function panelPosition(rect: DOMRect): React.CSSProperties {
  const PREFERRED_WIDTH = 336;
  const ESTIMATED_HEIGHT = 240;
  const MARGIN = 12;

  // Fall back to the document element when the window reports nothing
  // useful, so a zero-sized viewport can never drive the panel to 0px or
  // park it off screen.
  const viewportWidth =
    window.innerWidth || document.documentElement.clientWidth || PREFERRED_WIDTH + MARGIN * 2;
  const viewportHeight =
    window.innerHeight || document.documentElement.clientHeight || ESTIMATED_HEIGHT + MARGIN * 2;

  const width = Math.min(PREFERRED_WIDTH, Math.max(240, viewportWidth - MARGIN * 2));

  const spaceRight = viewportWidth - rect.right;
  const left =
    spaceRight > width + MARGIN
      ? rect.right + 8
      : Math.max(MARGIN, Math.min(rect.left - width + rect.width, viewportWidth - width - MARGIN));

  const spaceBelow = viewportHeight - rect.bottom;
  const top =
    spaceBelow > ESTIMATED_HEIGHT + MARGIN
      ? rect.top
      : Math.max(MARGIN, viewportHeight - ESTIMATED_HEIGHT - MARGIN);

  return { left, top, width };
}
