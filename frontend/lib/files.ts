import { api } from "@/lib/api";

/**
 * Files produced by POST endpoints — a rendered PDF, a sheet export.
 *
 * `api.download` covers GET. Renders take a body (which employee, which
 * filters, which format), so they go through POST and the same auth path,
 * then either open in a tab or save with the server's file name.
 */

async function fetchFile(path: string, body?: unknown): Promise<{ blob: Blob; fileName: string | null }> {
  const { data: response } = await api.post<Response>(path, body, { asResponse: true });
  const disposition = response.headers.get("content-disposition") || "";
  const match = /filename="?([^"]+)"?/.exec(disposition);
  return { blob: await response.blob(), fileName: match ? decodeURIComponent(match[1]) : null };
}

/** Open a rendered file in a new tab (previews). */
export async function openRendered(path: string, body?: unknown) {
  const { blob } = await fetchFile(path, body);
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank", "noopener");
  // A popup blocker leaves `opened` null; fall back to a same-tab navigation
  // rather than silently doing nothing.
  if (!opened) window.location.assign(url);
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/** Save a rendered file with the name the server chose. */
export async function saveRendered(path: string, body: unknown, fallbackName = "download") {
  const { blob, fileName } = await fetchFile(path, body);
  saveBlob(blob, fileName || fallbackName);
  return fileName || fallbackName;
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Save a JSON object as a file, for template exports built client-side. */
export function saveJson(object: unknown, fileName: string) {
  saveBlob(new Blob([JSON.stringify(object, null, 2)], { type: "application/json" }), fileName);
}

/** Read a picked file as parsed JSON, with a readable error. */
export function readJsonFile<T = unknown>(file: File): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)) as T);
      } catch {
        reject(new Error("That file is not valid JSON."));
      }
    };
    reader.readAsText(file);
  });
}

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
