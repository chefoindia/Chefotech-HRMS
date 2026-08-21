import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes, with later classes winning conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Read `{ id }` or a populated `{ id, name }` reference uniformly. */
export function refId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  const record = value as { id?: string; _id?: string };
  return record.id || record._id || null;
}

export function refLabel(value: unknown, fallback = "—"): string {
  if (!value) return fallback;
  if (typeof value === "string") return fallback;
  const record = value as { name?: string; employeeCode?: string; personal?: { firstName?: string; lastName?: string } };
  if (record.name) return record.name;
  if (record.personal) {
    return [record.personal.firstName, record.personal.lastName].filter(Boolean).join(" ") || fallback;
  }
  if (record.employeeCode) return record.employeeCode;
  return fallback;
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms = 300) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Deep-set a dotted path on a plain object, returning a new object. */
export function setPath<T extends Record<string, unknown>>(object: T, path: string, value: unknown): T {
  const parts = path.split(".");
  const clone: Record<string, unknown> = { ...object };
  let cursor = clone;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    cursor[key] = typeof cursor[key] === "object" && cursor[key] !== null ? { ...(cursor[key] as object) } : {};
    cursor = cursor[key] as Record<string, unknown>;
  }

  cursor[parts[parts.length - 1]] = value;
  return clone as T;
}

export function getPath(object: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, key) => (acc === null || acc === undefined ? undefined : (acc as Record<string, unknown>)[key]), object);
}

/** Remove keys whose value is undefined or an empty string. */
export function compact<T extends Record<string, unknown>>(object: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === "") continue;
    out[key] = value;
  }
  return out as Partial<T>;
}
