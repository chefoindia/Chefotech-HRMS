"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ChevronDown, ChevronUp, Copy, Download, EyeOff, Plus, RefreshCw, Save, Sigma, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import {
  Button,
  Callout,
  Card,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  FieldGrid,
  Input,
  Modal,
  NoAccessState,
  PageHeader,
  PageLoader,
  Select,
  Switch,
  Textarea,
  useToast,
} from "@/components/ui";
import { SheetFilterFields } from "@/components/documents/SheetFilters";
import { SheetRunDialog } from "@/components/documents/SheetRunDialog";
import { SheetScheduleDialog } from "@/components/documents/SheetScheduleDialog";
import { SHEET_FORMATS, columnForField, type SheetColumn, type SheetField, type SheetFilters, type SheetPreview, type SheetSource, type SheetTemplate } from "@/lib/documentTemplateTypes";

/**
 * The sheet designer.
 *
 * A sheet is a list of columns over a data source. Columns are fields the
 * source offers, or formulas over those fields ("BASIC + HRA", "net * 0.1").
 * The preview on the right is the real renderer over the real data, cut to
 * the first rows — so what the designer shows is what the XLSX contains.
 */
export default function SheetDesignerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<SheetTemplate | null>(null);
  const [dirty, setDirty] = useState(false);
  const [filters, setFilters] = useState<SheetFilters>({});
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [addingFields, setAddingFields] = useState(false);

  const { data: sheet, isLoading } = useQuery({
    queryKey: ["sheet", id],
    queryFn: async () => {
      const { data } = await api.get<SheetTemplate>(`/sheets/${id}`);
      return data;
    },
  });

  const { data: sources } = useQuery({
    queryKey: ["sheets", "sources"],
    queryFn: async () => {
      const { data } = await api.get<SheetSource[]>("/sheets/sources");
      return data;
    },
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (sheet) {
      setDraft(sheet);
      setDirty(false);
      setFilters((sheet.filters || {}) as SheetFilters);
    }
  }, [sheet]);

  const source = useMemo(() => sources?.find((s) => s.key === draft?.source) || null, [sources, draft?.source]);

  // Run-dependent fields (salary components) and period-dependent ones
  // (muster day columns) come from the server for the chosen filters.
  const { data: dynamicFields } = useQuery({
    queryKey: ["sheets", "fields", draft?.source, filters.runId, filters.fromDate, filters.toDate],
    queryFn: async () => {
      const { data } = await api.get<SheetField[]>(`/sheets/sources/${draft!.source}/fields`, {
        query: { runId: filters.runId as string | undefined, fromDate: filters.fromDate as string | undefined, toDate: filters.toDate as string | undefined },
      });
      return data;
    },
    enabled: Boolean(source?.dynamicFields && draft?.source),
  });
  const fields: SheetField[] = source?.dynamicFields ? dynamicFields || source.fields : source?.fields || [];

  const filtersReady = !source || ((!source.requiresDateRange || (filters.fromDate && filters.toDate)) && (!source.requiresRun || filters.runId));

  const preview = useQuery({
    queryKey: ["sheet", id, "preview", filters, sheet?.updatedAt],
    queryFn: async () => {
      const { data } = await api.post<SheetPreview>(`/sheets/${id}/preview`, { filters, limit: 20 });
      return data;
    },
    enabled: Boolean(sheet) && Boolean(filtersReady),
    retry: false,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return null;
      const { id: _id, isSystem, code, updatedAt, ...body } = draft;
      const { data } = await api.patch<SheetTemplate>(`/sheets/${id}`, { ...body, filters });
      return data;
    },
    onSuccess: (data) => {
      if (data) setDraft(data);
      setDirty(false);
      toast.success("Sheet saved");
      queryClient.invalidateQueries({ queryKey: ["sheets"] });
      queryClient.invalidateQueries({ queryKey: ["sheet", id] });
    },
    onError: (error) => toast.fromError(error, "Could not save this sheet."),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/sheets/${id}`),
    onSuccess: () => {
      toast.success(draft?.isSystem ? "Sheet deactivated" : "Sheet deleted");
      queryClient.invalidateQueries({ queryKey: ["sheets"] });
      router.push("/app/documents");
    },
    onError: (error) => toast.fromError(error, "Could not remove this sheet."),
  });

  const duplicate = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<SheetTemplate>(`/sheets/${id}/duplicate`);
      return data;
    },
    onSuccess: (data) => {
      toast.success("Duplicated", "You are editing the copy now.");
      queryClient.invalidateQueries({ queryKey: ["sheets"] });
      router.push(`/app/documents/sheets/${data.id}`);
    },
    onError: (error) => toast.fromError(error, "Could not duplicate this sheet."),
  });

  if (!can("report.manage_definitions")) return <NoAccessState what="the sheet designer" />;
  if (isLoading || !draft) return <PageLoader label="Loading sheet" />;

  const update = <K extends keyof SheetTemplate>(key: K, value: SheetTemplate[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setDirty(true);
  };
  const updateNested = <K extends "header" | "footer" | "page">(key: K, patch: Partial<SheetTemplate[K]>) => {
    setDraft((current) => (current ? { ...current, [key]: { ...current[key], ...patch } } : current));
    setDirty(true);
  };
  const setColumns = (columns: SheetColumn[]) => update("columns", columns);
  const columns = draft.columns || [];
  const usedKeys = new Set(columns.map((c) => c.key));
  const fieldKeys = fields.map((f) => f.key);

  const columnList = (
    <div className="space-y-2">
      {columns.length > 0 && (
        <div className="hidden grid-cols-[1.2fr_1.4fr_4.5rem_6rem_5rem_2.6rem_2.6rem_5.5rem] gap-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-subtle)] xl:grid">
          <span>Field</span>
          <span>Header</span>
          <span>Width</span>
          <span>Format</span>
          <span>Align</span>
          <span title="Sum in the totals row">Σ</span>
          <span title="Hidden">Hide</span>
          <span />
        </div>
      )}
      {columns.map((column, i) => {
        const isFormula = column.expression !== null && column.expression !== undefined && column.expression !== "";
        const known = fields.find((f) => f.key === column.key);
        return (
          <div key={column._id || i} className={`rounded-md border p-2 ${column.hidden ? "opacity-60" : ""}`}>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-[1.2fr_1.4fr_4.5rem_6rem_5rem_2.6rem_2.6rem_5.5rem]">
              {isFormula ? (
                <Input value={column.key} placeholder="result key, e.g. bonus" onChange={(e) => setColumns(columns.map((c, idx) => (idx === i ? { ...c, key: e.target.value.replace(/[^\w]/g, "_") } : c)))} aria-label="Formula column key" />
              ) : (
                <select
                  value={column.key}
                  onChange={(e) => {
                    const field = fields.find((f) => f.key === e.target.value);
                    setColumns(columns.map((c, idx) => (idx === i ? { ...c, key: e.target.value, label: c.label || field?.label || e.target.value, format: c.format || (field ? columnForField(field).format : "text") } : c)));
                  }}
                  className="input-base"
                  aria-label="Field"
                >
                  {!known && <option value={column.key}>{column.key} (not in this source)</option>}
                  {fields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                      {f.sensitive ? " 🔒" : ""}
                    </option>
                  ))}
                </select>
              )}
              <Input value={column.label} placeholder="Column header" onChange={(e) => setColumns(columns.map((c, idx) => (idx === i ? { ...c, label: e.target.value } : c)))} aria-label="Header" />
              <Input type="number" min={4} max={80} value={column.width ?? 16} onChange={(e) => setColumns(columns.map((c, idx) => (idx === i ? { ...c, width: Number(e.target.value) } : c)))} aria-label="Width" />
              <select value={column.format || "text"} onChange={(e) => setColumns(columns.map((c, idx) => (idx === i ? { ...c, format: e.target.value as SheetColumn["format"] } : c)))} className="input-base" aria-label="Format">
                {SHEET_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <select value={column.align || ""} onChange={(e) => setColumns(columns.map((c, idx) => (idx === i ? { ...c, align: (e.target.value || null) as SheetColumn["align"] } : c)))} className="input-base" aria-label="Alignment">
                <option value="">auto</option>
                <option value="left">left</option>
                <option value="center">center</option>
                <option value="right">right</option>
              </select>
              <div className="flex items-center justify-center" title="Sum this column in the totals row">
                <input type="checkbox" className="h-4 w-4 rounded border-[var(--border-strong)] text-brand-600" checked={Boolean(column.total)} onChange={(e) => setColumns(columns.map((c, idx) => (idx === i ? { ...c, total: e.target.checked } : c)))} aria-label="Total" />
              </div>
              <div className="flex items-center justify-center" title="Hidden columns are computed but not shown — useful as formula inputs">
                <input type="checkbox" className="h-4 w-4 rounded border-[var(--border-strong)] text-brand-600" checked={Boolean(column.hidden)} onChange={(e) => setColumns(columns.map((c, idx) => (idx === i ? { ...c, hidden: e.target.checked } : c)))} aria-label="Hidden" />
              </div>
              <div className="flex items-center justify-end gap-0.5">
                <Button variant="ghost" size="icon" disabled={i === 0} aria-label="Move up" onClick={() => setColumns(swap(columns, i, i - 1))}>
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" disabled={i === columns.length - 1} aria-label="Move down" onClick={() => setColumns(swap(columns, i, i + 1))}>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Remove column" onClick={() => setColumns(columns.filter((_, idx) => idx !== i))}>
                  <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" />
                </Button>
              </div>
            </div>
            {isFormula && (
              <div className="mt-2">
                <Input
                  value={column.expression || ""}
                  onChange={(e) => setColumns(columns.map((c, idx) => (idx === i ? { ...c, expression: e.target.value } : c)))}
                  placeholder="e.g. BASIC + HRA, or net * 0.1, or IF(lopDays > 0, 1, 0)"
                  aria-label="Formula"
                  hint={`Fields you can use: ${fieldKeys.slice(0, 14).join(", ")}${fieldKeys.length > 14 ? ", …" : ""}. Earlier columns are available by their key too.`}
                />
              </div>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAddingFields(true)} disabled={!fields.length}>
          Add fields
        </Button>
        <Button variant="outline" size="sm" icon={<Sigma className="h-3.5 w-3.5" />} onClick={() => setColumns([...columns, { key: `calc_${columns.length + 1}`, label: "Calculated", width: 14, format: "number", align: "right", expression: "", total: true }])}>
          Add formula column
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <PageHeader
        title={draft.name}
        description={
          <>
            {source ? source.label : draft.source} · {columns.filter((c) => !c.hidden).length} columns
            {draft.isSystem && " · starter sheet"}
            {dirty && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">unsaved changes</span>}
          </>
        }
        actions={
          <>
            <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => setDownloading(true)}>
              Download
            </Button>
            {can("report.export") && (
              <Button variant="outline" icon={<CalendarClock className="h-4 w-4" />} onClick={() => setScheduling(true)}>
                Schedule
              </Button>
            )}
            <Button variant="outline" icon={<Copy className="h-4 w-4" />} loading={duplicate.isPending} onClick={() => duplicate.mutate()}>
              Duplicate
            </Button>
            <Button variant="outline" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(true)}>
              {draft.isSystem ? "Deactivate" : "Delete"}
            </Button>
            <Button icon={<Save className="h-4 w-4" />} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
              Save
            </Button>
          </>
        }
      />

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="About this sheet" />
            <div className="mt-4 space-y-4">
              <FieldGrid columns={2}>
                <Input label="Name" value={draft.name} onChange={(e) => update("name", e.target.value)} required />
                <Input label="Code" value={draft.code} disabled hint="Used in file names." />
              </FieldGrid>
              <Textarea label="Description" rows={2} value={draft.description || ""} onChange={(e) => update("description", e.target.value)} />
              <Select
                label="Data source"
                value={draft.source}
                onChange={(e) => {
                  update("source", e.target.value);
                  setColumns([]);
                  setFilters({});
                }}
                options={(sources || []).map((s) => ({ value: s.key, label: s.label }))}
                hint={source?.description || "Changing the source clears the columns."}
              />
              <FieldGrid columns={2}>
                <Select label="Sort rows by" value={draft.sort || ""} onChange={(e) => update("sort", e.target.value || null)} placeholder="Source order" options={sortOptions(fields, columns)} hint="Prefix with - for descending is not needed: pick the field, the sheet sorts ascending." />
                <Select label="Group rows by" value={draft.groupBy || ""} onChange={(e) => update("groupBy", e.target.value || null)} placeholder="No grouping" options={fields.filter((f) => f.type === "text").map((f) => ({ value: f.key, label: f.label }))} hint="Each group gets its own subtotal." />
              </FieldGrid>
              <Switch label="Active" checked={draft.isActive} onChange={(v) => update("isActive", v)} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Columns" description="What each row shows, left to right. Formula columns compute from other fields." />
            <div className="mt-4">{columnList}</div>
          </Card>

          <Card>
            <CardHeader title="Header and footer" />
            <div className="mt-4 space-y-3">
              <FieldGrid columns={2}>
                <Input label="Title on the sheet" placeholder={draft.name} value={draft.header?.title || ""} onChange={(e) => updateNested("header", { title: e.target.value })} />
                <Input label="Subtitle" value={draft.header?.subtitle || ""} onChange={(e) => updateNested("header", { subtitle: e.target.value })} />
              </FieldGrid>
              <FieldGrid columns={3}>
                <Checkbox label="Company name" checked={draft.header?.showCompany !== false} onChange={(e) => updateNested("header", { showCompany: e.target.checked })} />
                <Checkbox label="Period / run" checked={draft.header?.showPeriod !== false} onChange={(e) => updateNested("header", { showPeriod: e.target.checked })} />
                <Checkbox label="Generated on" checked={draft.header?.showGeneratedOn !== false} onChange={(e) => updateNested("header", { showGeneratedOn: e.target.checked })} />
              </FieldGrid>
              <Input label="Footer note" placeholder="e.g. System generated — no signature required" value={draft.footer?.text || ""} onChange={(e) => updateNested("footer", { text: e.target.value })} />
              <Input
                label="Signature lines (comma separated)"
                placeholder="Prepared by, Checked by, Approved by"
                value={(draft.footer?.signatureLabels || []).join(", ")}
                onChange={(e) => updateNested("footer", { signatureLabels: e.target.value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4) })}
                hint="Printed at the bottom of the PDF."
              />
              <FieldGrid columns={3}>
                <Checkbox label="Totals row" checked={draft.footer?.showTotals !== false} onChange={(e) => updateNested("footer", { showTotals: e.target.checked })} />
                <Checkbox label="Freeze the header row" checked={draft.freezeHeader !== false} onChange={(e) => update("freezeHeader", e.target.checked)} />
                <Checkbox label="Number the rows" checked={draft.showRowNumbers !== false} onChange={(e) => update("showRowNumbers", e.target.checked)} />
              </FieldGrid>
              <FieldGrid columns={2}>
                <Select
                  label="PDF orientation"
                  value={draft.page?.orientation || "landscape"}
                  onChange={(e) => updateNested("page", { orientation: e.target.value as SheetTemplate["page"]["orientation"] })}
                  options={[
                    { value: "landscape", label: "Landscape" },
                    { value: "portrait", label: "Portrait" },
                  ]}
                />
                <Select
                  label="PDF page size"
                  value={draft.page?.size || "A4"}
                  onChange={(e) => updateNested("page", { size: e.target.value as SheetTemplate["page"]["size"] })}
                  options={["A4", "A3", "LETTER", "LEGAL"].map((s) => ({ value: s, label: s }))}
                />
              </FieldGrid>
            </div>
          </Card>
        </div>

        <div className="space-y-5 2xl:sticky 2xl:top-6 2xl:self-start">
          <Card>
            <CardHeader
              title="Live preview"
              description="The first 20 rows, formatted exactly as the file will be."
              action={
                <Button variant="ghost" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => preview.refetch()} loading={preview.isFetching}>
                  Refresh
                </Button>
              }
            />
            {source && source.filters.length > 0 && (
              <div className="mt-4">
                <SheetFilterFields keys={source.filters.filter((k) => k !== "employeeIds")} value={filters} onChange={(next) => { setFilters(next); setDirty(true); }} requiresDateRange={source.requiresDateRange} requiresRun={source.requiresRun} columns={3} />
                <p className="mt-1 text-[11.5px] text-[var(--text-subtle)]">These filters are saved with the sheet as its defaults. Whoever downloads it can change them.</p>
              </div>
            )}
            {dirty && <Callout tone="info" className="mt-3">The preview shows the saved sheet. Save to see your column changes here.</Callout>}
            <div className="mt-4">
              {!filtersReady ? (
                <p className="rounded-md border border-dashed p-6 text-center text-[13px] text-[var(--text-muted)]">Choose the {source?.requiresRun ? "payroll run" : "date range"} above to see data.</p>
              ) : preview.isLoading ? (
                <div className="skeleton h-48" />
              ) : preview.error ? (
                <Callout tone="danger">{(preview.error as Error).message}</Callout>
              ) : preview.data ? (
                <PreviewTable preview={preview.data} showRowNumbers={draft.showRowNumbers !== false} />
              ) : null}
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={addingFields}
        onClose={() => setAddingFields(false)}
        title="Add fields"
        size="md"
        footer={
          <Button onClick={() => setAddingFields(false)}>Done</Button>
        }
      >
        <div className="space-y-2">
          <p className="text-[12.5px] text-[var(--text-muted)]">Tick the fields to add as columns. Locked fields need the &quot;view sensitive data&quot; permission at download time.</p>
          <div className="max-h-96 overflow-y-auto rounded-md border">
            <ul className="divide-y">
              {fields.map((field) => (
                <li key={field.key} className="px-3 py-1.5">
                  <Checkbox
                    label={
                      <span className="text-[13px]">
                        {field.label} <span className="text-[var(--text-subtle)]">· {field.type}{field.sensitive ? " · 🔒" : ""}</span>
                      </span>
                    }
                    checked={usedKeys.has(field.key)}
                    onChange={(e) => {
                      if (e.target.checked) setColumns([...columns, columnForField(field)]);
                      else setColumns(columns.filter((c) => c.key !== field.key || c.expression));
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
          <Button variant="outline" size="sm" onClick={() => setColumns([...columns, ...fields.filter((f) => !usedKeys.has(f.key) && !f.sensitive).map(columnForField)])}>
            Add every non-sensitive field
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        tone="danger"
        title={draft.isSystem ? "Deactivate this sheet?" : "Delete this sheet?"}
        confirmLabel={draft.isSystem ? "Deactivate" : "Delete"}
        message="Files already downloaded are unaffected."
      />

      {downloading && <SheetRunDialog sheet={{ ...draft, filters }} onClose={() => setDownloading(false)} />}
      {scheduling && <SheetScheduleDialog sheet={{ ...draft, filters }} source={source || undefined} onClose={() => setScheduling(false)} />}
    </>
  );
}

function swap<T>(list: T[], a: number, b: number) {
  const next = [...list];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

function sortOptions(fields: SheetField[], columns: SheetColumn[]) {
  const seen = new Set<string>();
  const out: Array<{ value: string; label: string }> = [];
  for (const f of fields) {
    seen.add(f.key);
    out.push({ value: f.key, label: f.label });
  }
  for (const c of columns) {
    if (c.expression && c.key && !seen.has(c.key)) out.push({ value: c.key, label: `${c.label || c.key} (formula)` });
  }
  return out;
}

function PreviewTable({ preview, showRowNumbers }: { preview: SheetPreview; showRowNumbers: boolean }) {
  if (!preview.rowCount) {
    return <p className="rounded-md border border-dashed p-6 text-center text-[13px] text-[var(--text-muted)]">No rows for these filters.</p>;
  }
  let index = 0;
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-[var(--text-muted)]">
        {preview.rowCount} row{preview.rowCount === 1 ? "" : "s"}
        {preview.truncated ? " (showing the first 20)" : ""}
        {preview.meta.periodLabel ? ` · ${preview.meta.periodLabel}` : ""}
      </p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-[12px]">
          <thead className="bg-[var(--surface-muted)] text-left text-[11px] uppercase tracking-wide text-[var(--text-subtle)]">
            <tr>
              {showRowNumbers && <th className="px-2 py-1.5">#</th>}
              {preview.columns.map((c) => (
                <th key={c.key} className={`whitespace-nowrap px-2 py-1.5 ${c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {preview.groups.map((group, g) => (
              <GroupRows key={g} group={group} columns={preview.columns} showRowNumbers={showRowNumbers} startIndex={(() => { const start = index; index += group.rows.length; return start; })()} />
            ))}
          </tbody>
          {Object.keys(preview.totals || {}).length > 0 && (
            <tfoot className="bg-[var(--surface-muted)] font-medium">
              <tr>
                {showRowNumbers && <td className="px-2 py-1.5" />}
                {preview.columns.map((c, i) => (
                  <td key={c.key} className={`whitespace-nowrap px-2 py-1.5 ${c.align === "right" ? "text-right" : ""}`}>
                    {preview.totals[c.key] ?? (i === 0 ? "Total" : "")}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function GroupRows({ group, columns, showRowNumbers, startIndex }: { group: SheetPreview["groups"][number]; columns: SheetPreview["columns"]; showRowNumbers: boolean; startIndex: number }) {
  return (
    <>
      {group.label && (
        <tr className="bg-brand-50/50">
          <td colSpan={columns.length + (showRowNumbers ? 1 : 0)} className="px-2 py-1 text-[11.5px] font-semibold text-brand-700">
            {group.label}
          </td>
        </tr>
      )}
      {group.rows.map((row, r) => (
        <tr key={r} className="hover:bg-[var(--surface-muted)]">
          {showRowNumbers && <td className="px-2 py-1 text-[var(--text-subtle)]">{startIndex + r + 1}</td>}
          {columns.map((c) => (
            <td key={c.key} className={`whitespace-nowrap px-2 py-1 ${c.align === "right" ? "text-right tabular-nums" : c.align === "center" ? "text-center" : ""}`}>
              {row[c.key] === "" || row[c.key] === undefined ? <span className="text-[var(--text-subtle)]">—</span> : row[c.key]}
            </td>
          ))}
        </tr>
      ))}
      {group.label && group.totals && Object.keys(group.totals).length > 0 && (
        <tr className="bg-[var(--surface-muted)] text-[11.5px] font-medium">
          {showRowNumbers && <td />}
          {columns.map((c, i) => (
            <td key={c.key} className={`px-2 py-1 ${c.align === "right" ? "text-right" : ""}`}>
              {group.totals[c.key] !== undefined ? String(group.totals[c.key]) : i === 0 ? `${group.label} total` : ""}
            </td>
          ))}
        </tr>
      )}
    </>
  );
}

// Keep the icon import used for hidden-column affordance in future rows.
void EyeOff;
