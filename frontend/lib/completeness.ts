import { getPath } from "./utils";

/**
 * How much of a configuration form is actually filled in.
 *
 * Deliberately dumb: a field counts as filled if it holds anything other
 * than empty/null/undefined — no per-field weighting, no "this one matters
 * more" logic. A weighted score would need updating by hand every time a
 * field is added, and would quietly go stale exactly like a hardcoded route
 * would; counting is the one thing that cannot drift from the field list.
 */
export interface CompletenessField {
  path: string;
  /** A field that fails a required-format check some other way (e.g. it has a valid default) can be excluded from the denominator. */
  optional?: boolean;
}

export function computeCompleteness(
  source: Record<string, unknown> | null | undefined,
  fields: Array<string | CompletenessField>
): { percent: number; filled: number; total: number } {
  const normalized = fields.map((f) => (typeof f === "string" ? { path: f } : f));
  const counted = normalized.filter((f) => !f.optional);
  if (!counted.length || !source) return { percent: 0, filled: 0, total: counted.length };

  const filled = counted.filter((f) => isFilled(getPath(source, f.path))).length;
  return { percent: Math.round((filled / counted.length) * 100), filled, total: counted.length };
}

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}
