/**
 * The fallback shown while a route segment's code is still loading.
 *
 * Without one, React holds the previous page on screen until the next is fully
 * ready, so a slow route looks like a click that did nothing. This renders
 * immediately and keeps the shell's shape, which makes the wait read as
 * loading rather than as breakage — and because it mirrors the real page
 * layout, the content does not jump when it arrives.
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      {/* Page heading */}
      <div className="space-y-2.5">
        <div className="h-7 w-56 rounded-md bg-[var(--surface-hover,#f1f5f9)]" />
        <div className="h-4 w-96 max-w-full rounded bg-[var(--surface-hover,#f1f5f9)]" />
      </div>

      {/* The stat row most sections open with */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-xl border border-[var(--border,#e2e8f0)] bg-[var(--surface,#fff)]"
          />
        ))}
      </div>

      {/* Table or card body */}
      <div className="rounded-xl border border-[var(--border,#e2e8f0)] bg-[var(--surface,#fff)] p-5">
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="h-9 w-9 shrink-0 rounded-full bg-[var(--surface-hover,#f1f5f9)]" />
              <div className="h-4 flex-1 rounded bg-[var(--surface-hover,#f1f5f9)]" />
              <div className="hidden h-4 w-28 rounded bg-[var(--surface-hover,#f1f5f9)] sm:block" />
              <div className="hidden h-4 w-20 rounded bg-[var(--surface-hover,#f1f5f9)] md:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
