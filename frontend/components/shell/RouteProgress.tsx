"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * The navigation progress bar.
 *
 * The App Router gives no "navigation started" event — `usePathname()` only
 * changes once the next route is already rendering, which is far too late to
 * be useful. Between the click and that moment the whole interface sits
 * motionless, and on a slow connection or a cold route that reads as a frozen
 * app rather than a loading one.
 *
 * So the start of a navigation is detected at its true source: a click on a
 * same-document link, and the history methods `router.push` / `router.replace`
 * call underneath. The end is the pathname or query string actually changing.
 *
 * The bar eases towards 90% and waits there. Progress during a navigation is
 * genuinely unknowable — there is no total to divide by — so the honest thing
 * is a bar that shows *work is happening* and never claims to be finished
 * early. It completes only when the new route is live.
 */

/** Below this, a navigation finishes before the eye registers a bar at all. */
const SHOW_AFTER_MS = 120;
/** How long the finished bar stays at 100% before fading out. */
const FADE_MS = 220;
/** A navigation still unresolved after this is treated as abandoned. */
const STUCK_AFTER_MS = 20_000;

export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  // Refs, not state: these are touched by timers and event handlers that must
  // not each queue a re-render.
  const timers = useRef<{ show?: number; tick?: number; hide?: number; safety?: number }>({});
  const running = useRef(false);
  // Completion is reachable from two places — the route actually changing, and
  // the page being torn down. An earlier version implemented it twice and the
  // two copies drifted, which left the bar stuck at full width on screen. One
  // implementation, shared through a ref.
  const finishRef = useRef<() => void>(() => {});

  useEffect(() => {
    const clearTimers = () => {
      for (const key of ["show", "tick", "hide", "safety"] as const) {
        if (timers.current[key]) window.clearTimeout(timers.current[key]);
        timers.current[key] = undefined;
      }
    };

    const finish = () => {
      if (!running.current) return;
      running.current = false;
      clearTimers();
      setProgress(100);
      timers.current.hide = window.setTimeout(() => {
        setVisible(false);
        // Reset only once invisible, so the bar never visibly rewinds.
        timers.current.hide = window.setTimeout(() => setProgress(0), FADE_MS);
      }, FADE_MS);
    };
    finishRef.current = finish;

    const start = () => {
      if (running.current) return;
      running.current = true;
      clearTimers();

      // A navigation can be abandoned without the route ever changing — a
      // cancelled fetch, a redirect back to where we already were, a failed
      // chunk. Without this the bar would creep to 90% and sit there for the
      // rest of the session, which looks far more broken than no bar at all.
      timers.current.safety = window.setTimeout(finish, STUCK_AFTER_MS);

      // Hold off briefly. A cached client-side route resolves in a few
      // milliseconds, and flashing a bar for every one of those is noise.
      timers.current.show = window.setTimeout(() => {
        setVisible(true);
        setProgress(8);

        // Decelerating creep: large steps early, tiny ones near the ceiling,
        // so the bar keeps moving on a long navigation without ever arriving.
        const tick = () => {
          setProgress((current) => {
            if (current >= 90) return current;
            const step = current < 40 ? 9 : current < 65 ? 4 : 1.5;
            return Math.min(90, current + step);
          });
          timers.current.tick = window.setTimeout(tick, 240);
        };
        timers.current.tick = window.setTimeout(tick, 240);
      }, SHOW_AFTER_MS);
    };

    // ── Detecting the start of a navigation ────────────────────────────────
    //
    // A plain <Link> click ends up calling history.pushState, but so does a
    // lot of harmless component state syncing, so clicks are handled directly
    // and history is patched only as the fallback for programmatic pushes.

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;

      const next = new URL(href, window.location.href);
      if (next.origin !== window.location.origin) return;
      // A pure hash change scrolls the current page; nothing is loading.
      if (next.pathname === window.location.pathname && next.search === window.location.search) {
        return;
      }
      start();
    };

    const { pushState, replaceState } = window.history;
    const patch =
      (original: typeof pushState) =>
      function (this: History, ...args: Parameters<typeof pushState>) {
        const url = args[2];
        if (url) {
          const next = new URL(String(url), window.location.href);
          if (next.pathname !== window.location.pathname || next.search !== window.location.search) {
            start();
          }
        }
        return original.apply(this, args);
      };

    window.history.pushState = patch(pushState);
    window.history.replaceState = patch(replaceState);

    document.addEventListener("click", onClick, { capture: true });
    window.addEventListener("popstate", start);
    // A navigation that leaves the app entirely never resolves in here.
    window.addEventListener("beforeunload", finish);

    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("popstate", start);
      window.removeEventListener("beforeunload", finish);
      window.history.pushState = pushState;
      window.history.replaceState = replaceState;
      clearTimers();
      running.current = false;
    };
  }, []);

  // The new route is rendering — that is the only trustworthy "finished".
  useEffect(() => {
    finishRef.current();
  }, [pathname, searchParams]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-[3px]"
      style={{ opacity: visible ? 1 : 0, transition: `opacity ${FADE_MS}ms ease-out` }}
    >
      <div
        className="h-full origin-left bg-gradient-to-r from-brand-400 via-brand-600 to-brand-400"
        style={{
          width: `${progress}%`,
          // Snappy at the finish, unhurried during the creep.
          transition: progress === 100 ? "width 180ms ease-out" : "width 320ms ease-out",
          boxShadow: "0 0 8px 0 var(--brand-500, #4f46e5)",
        }}
      />
    </div>
  );
}

/**
 * A route bar is only honest about *navigation*. Work that happens without a
 * URL change — saving a form, processing payroll — needs its own signal, which
 * is what this indeterminate variant is for.
 */
export function InlineProgress({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-brand-600" />
      {label && <span className="text-[13px] text-[var(--text-muted)]">{label}</span>}
    </div>
  );
}
