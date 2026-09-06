"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Braces, Search } from "lucide-react";
import type { TemplateVariable } from "@/lib/documentTemplateTypes";

/**
 * The list of fields a template can use, and the button that inserts one.
 *
 * The variables come from the server, built from a real employee's data, so
 * the picker can never offer a field the renderer would print as blank.
 * They are provided once at the editor root and read by every block below.
 */

const VariablesContext = createContext<TemplateVariable[]>([]);

export function VariablesProvider({ variables, children }: { variables: TemplateVariable[]; children: React.ReactNode }) {
  return <VariablesContext.Provider value={variables}>{children}</VariablesContext.Provider>;
}

export function useTemplateVariables() {
  return useContext(VariablesContext);
}

/** Insert text at the caret of an input or textarea, keeping React state in sync. */
export function insertAtCaret(
  element: HTMLTextAreaElement | HTMLInputElement | null,
  current: string,
  snippet: string,
  apply: (next: string) => void
) {
  if (!element) {
    apply(`${current}${snippet}`);
    return;
  }
  const start = element.selectionStart ?? current.length;
  const end = element.selectionEnd ?? current.length;
  const next = `${current.slice(0, start)}${snippet}${current.slice(end)}`;
  apply(next);
  requestAnimationFrame(() => {
    element.focus();
    const caret = start + snippet.length;
    try {
      element.setSelectionRange(caret, caret);
    } catch {
      /* number inputs cannot position a caret */
    }
  });
}

export function FieldPicker({
  onPick,
  label = "Insert field",
  compact = false,
  targetRef,
  value,
  onChange,
}: {
  /** Called with "{{path}}". Either supply this, or targetRef + value + onChange. */
  onPick?: (snippet: string) => void;
  label?: string;
  compact?: boolean;
  targetRef?: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  value?: string;
  onChange?: (next: string) => void;
}) {
  const variables = useTemplateVariables();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q ? variables.filter((v) => v.path.toLowerCase().includes(q) || v.example.toLowerCase().includes(q)) : variables;
    return rows.slice(0, 80);
  }, [variables, query]);

  const groups = useMemo(() => {
    const out = new Map<string, TemplateVariable[]>();
    for (const variable of filtered) {
      const group = variable.path.replace(/^\{\{/, "").split(".")[0];
      if (!out.has(group)) out.set(group, []);
      out.get(group)!.push(variable);
    }
    return [...out.entries()];
  }, [filtered]);

  const pick = (variable: TemplateVariable) => {
    if (onPick) onPick(variable.path);
    else if (targetRef && onChange !== undefined && value !== undefined) {
      insertAtCaret(targetRef.current, value, variable.path, onChange);
    }
    setOpen(false);
    setQuery("");
  };

  if (!variables.length) return null;

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          compact
            ? "inline-flex h-7 items-center gap-1 rounded border px-2 text-[11.5px] font-medium text-brand-700 hover:bg-brand-50"
            : "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium text-brand-700 hover:bg-brand-50"
        }
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Braces className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden />
        {label}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-80 rounded-[var(--radius)] border bg-[var(--surface)] shadow-lg">
          <div className="relative border-b p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-subtle)]" aria-hidden />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search fields…"
              className="input-base h-8 pl-8 text-[12.5px]"
              aria-label="Search fields"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1" role="listbox">
            {groups.length === 0 && <p className="px-2 py-3 text-center text-[12px] text-[var(--text-muted)]">No field matches.</p>}
            {groups.map(([group, rows]) => (
              <div key={group}>
                <p className="px-2 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">{group}</p>
                {rows.map((variable) => (
                  <button
                    key={variable.path}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => pick(variable)}
                    className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-[var(--surface-muted)]"
                  >
                    <span className="truncate font-mono text-[11.5px] text-brand-700">{variable.path}</span>
                    {variable.example && <span className="truncate text-[11px] text-[var(--text-subtle)]">{variable.example}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
