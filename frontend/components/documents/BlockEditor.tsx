"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, Copy, GripVertical, ImageIcon, Plus, Trash2, Upload } from "lucide-react";
import { api, API_PREFIX, BASE_URL, tokens } from "@/lib/api";
import { Button, Checkbox, FieldGrid, Input, Select, Textarea, useToast } from "@/components/ui";
import { BLOCK_HINTS, BLOCK_LABELS, COLUMN_FORMATS, type BlockColumn, type TemplateBlock } from "@/lib/documentTemplateTypes";
import { FieldPicker, useTemplateVariables } from "./FieldPicker";

/**
 * One block in a document template, editable in place.
 *
 * The fields shown depend on the block's type — a spacer has a height, a
 * table has columns, a paragraph has style — because that mirrors exactly
 * what `pdfRenderer.js` reads for each type. Nothing here is a field the
 * renderer would silently ignore, and nothing the renderer draws is missing.
 */
export function BlockEditor({
  block,
  index,
  total,
  templateId,
  onChange,
  onRemove,
  onMove,
  onDuplicate,
}: {
  block: TemplateBlock;
  index: number;
  total: number;
  templateId: string;
  onChange: (patch: Partial<TemplateBlock>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const style = block.style || {};

  const setStyle = (patch: Partial<NonNullable<TemplateBlock["style"]>>) => onChange({ style: { ...style, ...patch } });

  return (
    <div className="rounded-[var(--radius)] border bg-[var(--surface)]">
      <div className="flex items-center gap-2 border-b bg-[var(--surface-muted)] px-3 py-2">
        <GripVertical className="h-4 w-4 shrink-0 text-[var(--text-subtle)]" aria-hidden />
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="text-[13px] font-medium text-[var(--text)]">{BLOCK_LABELS[block.type]}</span>
          {!expanded && blockSummary(block) && <span className="truncate text-[12px] text-[var(--text-subtle)]">— {blockSummary(block)}</span>}
          {block.condition && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700">conditional</span>}
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="icon" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Move down">
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDuplicate} aria-label="Duplicate block">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove block">
            <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3.5 p-3.5">
          <p className="text-[12px] text-[var(--text-subtle)]">{BLOCK_HINTS[block.type]}</p>
          <BlockFields block={block} onChange={onChange} templateId={templateId} />

          {hasStyle(block.type) && (
            <FieldGrid columns={3}>
              <Input
                label="Font size"
                type="number"
                min={6}
                max={48}
                value={style.fontSize ?? ""}
                placeholder="default"
                onChange={(e) => setStyle({ fontSize: e.target.value ? Number(e.target.value) : null })}
              />
              <Select
                label="Alignment"
                value={style.align || "left"}
                onChange={(e) => setStyle({ align: e.target.value as NonNullable<typeof style.align> })}
                options={[
                  { value: "left", label: "Left" },
                  { value: "center", label: "Center" },
                  { value: "right", label: "Right" },
                  { value: "justify", label: "Justify" },
                ]}
              />
              <Input label="Colour" placeholder="#1F2937" value={style.colour || ""} onChange={(e) => setStyle({ colour: e.target.value || null })} />
              <Input
                label="Space above"
                type="number"
                min={0}
                max={200}
                value={style.marginTop ?? ""}
                placeholder="default"
                onChange={(e) => setStyle({ marginTop: e.target.value ? Number(e.target.value) : null })}
              />
              <Input
                label="Space below"
                type="number"
                min={0}
                max={200}
                value={style.marginBottom ?? ""}
                placeholder="default"
                onChange={(e) => setStyle({ marginBottom: e.target.value ? Number(e.target.value) : null })}
              />
              {(block.type === "paragraph" || block.type === "columns" || block.type === "list" || block.type === "checklist") && (
                <div className="flex items-end gap-4 pb-2">
                  <Checkbox label="Bold" checked={Boolean(style.bold)} onChange={(e) => setStyle({ bold: e.target.checked })} />
                  <Checkbox label="Italic" checked={Boolean(style.italic)} onChange={(e) => setStyle({ italic: e.target.checked })} />
                </div>
              )}
            </FieldGrid>
          )}

          <ConditionField block={block} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function hasStyle(type: TemplateBlock["type"]) {
  return ["heading", "paragraph", "list", "checklist", "signature", "columns", "key_values", "table"].includes(type);
}

function blockSummary(block: TemplateBlock): string {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "signature":
      return (block.text || "").slice(0, 90);
    case "list":
    case "checklist":
      return (block.items || []).join(", ").slice(0, 90);
    case "columns":
      return `${(block.left || "").slice(0, 40)} | ${(block.right || "").slice(0, 40)}`;
    case "spacer":
      return `${block.height ?? 12}px`;
    case "table":
      return block.source ? `from ${block.source}` : `${(block.rows || []).length} typed row(s)`;
    case "key_values":
      return block.source ? `from ${block.source}` : `${(block.rows || []).length} pair(s)`;
    case "image":
      return block.fileId ? "image uploaded" : "no image yet";
    case "qr":
      return "verification code";
    default:
      return "";
  }
}

function ConditionField({ block, onChange }: { block: TemplateBlock; onChange: (patch: Partial<TemplateBlock>) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Input
      ref={ref}
      label="Only print when (optional)"
      placeholder="e.g. salary.ctcAnnual > 0"
      value={block.condition || ""}
      onChange={(e) => onChange({ condition: e.target.value || null })}
      hint="A formula over the same fields. Left blank, the block always prints."
      labelSuffix={<FieldPicker compact targetRef={ref} value={block.condition || ""} onChange={(next) => onChange({ condition: next || null })} />}
    />
  );
}

/** A textarea with an "insert field" button that drops {{path}} at the caret. */
function TextWithFields({
  label,
  value,
  onChange,
  rows = 4,
  hint,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  hint?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <Textarea
      ref={ref}
      label={label}
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      hint={hint}
      labelSuffix={<FieldPicker compact targetRef={ref} value={value} onChange={onChange} />}
    />
  );
}

function BlockFields({ block, onChange, templateId }: { block: TemplateBlock; onChange: (patch: Partial<TemplateBlock>) => void; templateId: string }) {
  switch (block.type) {
    case "heading":
      return (
        <div className="space-y-3">
          <TextWithFields label="Text" rows={2} value={block.text || ""} onChange={(text) => onChange({ text })} />
          <FieldGrid columns={2}>
            <Select
              label="Size"
              value={String(block.level || 1)}
              onChange={(e) => onChange({ level: Number(e.target.value) })}
              options={[
                { value: "1", label: "Document title" },
                { value: "2", label: "Section heading" },
                { value: "3", label: "Sub-heading" },
              ]}
            />
            <div className="flex items-end pb-2">
              <Checkbox label="Underline" checked={Boolean(block.underline)} onChange={(e) => onChange({ underline: e.target.checked })} />
            </div>
          </FieldGrid>
        </div>
      );

    case "paragraph":
      return (
        <TextWithFields
          label="Text"
          rows={5}
          value={block.text || ""}
          onChange={(text) => onChange({ text })}
          hint="**bold** and _italic_ work inline. A blank line starts a new paragraph."
        />
      );

    case "columns":
      return (
        <FieldGrid columns={2}>
          <TextWithFields label="Left column" rows={4} value={block.left || ""} onChange={(left) => onChange({ left })} />
          <TextWithFields label="Right column" rows={4} value={block.right || ""} onChange={(right) => onChange({ right })} />
        </FieldGrid>
      );

    case "signature":
      return <SignatureEditor block={block} onChange={onChange} templateId={templateId} />;

    case "list":
    case "checklist":
      return <ListItemsEditor block={block} onChange={onChange} />;

    case "spacer":
      return <Input label="Height (px)" type="number" min={4} max={200} value={block.height ?? 12} onChange={(e) => onChange({ height: Number(e.target.value) })} />;

    case "divider":
      return null;

    case "page_break":
      return null;

    case "table":
      return <TableEditor block={block} onChange={onChange} />;

    case "key_values":
      return <KeyValuesEditor block={block} onChange={onChange} />;

    case "image":
      return <ImageBlockEditor block={block} onChange={onChange} templateId={templateId} />;

    case "qr":
      return (
        <FieldGrid columns={2}>
          <Input label="Size (px)" type="number" min={40} max={200} value={block.height ?? 80} onChange={(e) => onChange({ height: Number(e.target.value) })} />
          <Select
            label="Position"
            value={block.align || "right"}
            onChange={(e) => onChange({ align: e.target.value as "left" | "right" })}
            options={[
              { value: "left", label: "Left" },
              { value: "right", label: "Right" },
            ]}
          />
          <p className="col-span-2 text-[12px] text-[var(--text-muted)]">
            The QR links to the public verification page for the generated document. In a preview it shows a placeholder code.
          </p>
        </FieldGrid>
      );

    default:
      return null;
  }
}

function ListItemsEditor({ block, onChange }: { block: TemplateBlock; onChange: (patch: Partial<TemplateBlock>) => void }) {
  const items = block.items || [];
  const set = (next: string[]) => onChange({ items: next });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-[13px] font-medium text-[var(--text)]">{block.type === "checklist" ? "Items to tick" : "List items"}</label>
        <FieldPicker compact onPick={(snippet) => set([...items, snippet])} label="Add field as item" />
      </div>
      {items.map((item, i) => (
        <div key={i} className="flex gap-2">
          <Input value={item} onChange={(e) => set(items.map((v, idx) => (idx === i ? e.target.value : v)))} containerClassName="flex-1" />
          <Button variant="ghost" size="icon" onClick={() => set(items.filter((_, idx) => idx !== i))} aria-label="Remove item">
            <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set([...items, ""])}>
        Add item
      </Button>
    </div>
  );
}

/** Table and key-value blocks share the same "live data, or type it in yourself" choice. */
function SourceOrRows({
  block,
  onChange,
  mode,
  setMode,
  children,
}: {
  block: TemplateBlock;
  onChange: (patch: Partial<TemplateBlock>) => void;
  mode: "source" | "rows";
  setMode: (mode: "source" | "rows") => void;
  children: React.ReactNode;
}) {
  const variables = useTemplateVariables();
  const listFields = variables.filter((v) => v.example.startsWith("") && /item\(s\)/.test(v.example));

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 rounded-md border p-0.5">
        <button
          type="button"
          onClick={() => {
            setMode("source");
            onChange({ rows: [] });
          }}
          className={`flex-1 rounded px-2.5 py-1.5 text-[12.5px] font-medium ${mode === "source" ? "bg-brand-600 text-white" : "text-[var(--text-muted)]"}`}
        >
          Pull rows from data
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("rows");
            onChange({ source: null });
          }}
          className={`flex-1 rounded px-2.5 py-1.5 text-[12.5px] font-medium ${mode === "rows" ? "bg-brand-600 text-white" : "text-[var(--text-muted)]"}`}
        >
          Type the rows in
        </button>
      </div>

      {mode === "source" ? (
        listFields.length ? (
          <Select
            label="Data list"
            value={block.source || ""}
            onChange={(e) => onChange({ source: e.target.value || null })}
            placeholder="Choose a list…"
            options={listFields.map((v) => ({ value: v.path.replace(/^\{\{|\}\}$/g, ""), label: `${v.path.replace(/^\{\{|\}\}$/g, "")} — ${v.example}` }))}
            hint="Each item in the list becomes a row."
          />
        ) : (
          <Input
            label="Data list"
            placeholder="e.g. salary.lines"
            value={block.source || ""}
            onChange={(e) => onChange({ source: e.target.value || null })}
            hint="A field holding a list — salary.lines, payslip.earnings, settlement.dues."
          />
        )
      ) : (
        children
      )}
    </div>
  );
}

function TableEditor({ block, onChange }: { block: TemplateBlock; onChange: (patch: Partial<TemplateBlock>) => void }) {
  const [mode, setMode] = useState<"source" | "rows">(block.source ? "source" : "rows");
  const columns = block.columns || [];
  const setColumns = (next: BlockColumn[]) => onChange({ columns: next });
  const rows = (block.rows || []) as Array<Record<string, string>>;
  const setRows = (next: Array<Record<string, string>>) => onChange({ rows: next });

  return (
    <div className="space-y-3.5">
      <div className="space-y-2">
        <label className="block text-[13px] font-medium text-[var(--text)]">Columns</label>
        {columns.length > 0 && (
          <div className="hidden grid-cols-[1fr_1fr_4rem_5.5rem_6rem_3rem_2rem] gap-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-subtle)] md:grid">
            <span>Field key</span>
            <span>Header</span>
            <span>Width</span>
            <span>Align</span>
            <span>Format</span>
            <span>Total</span>
            <span />
          </div>
        )}
        {columns.map((col, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-[1fr_1fr_4rem_5.5rem_6rem_3rem_2rem]">
            <Input placeholder="e.g. name" value={col.key} onChange={(e) => setColumns(columns.map((c, idx) => (idx === i ? { ...c, key: e.target.value } : c)))} />
            <Input placeholder="Column header" value={col.label} onChange={(e) => setColumns(columns.map((c, idx) => (idx === i ? { ...c, label: e.target.value } : c)))} />
            <Input type="number" min={0.5} max={20} step={0.5} value={col.width ?? 1} onChange={(e) => setColumns(columns.map((c, idx) => (idx === i ? { ...c, width: Number(e.target.value) } : c)))} aria-label="Relative width" />
            <select
              value={col.align || "left"}
              onChange={(e) => setColumns(columns.map((c, idx) => (idx === i ? { ...c, align: e.target.value as BlockColumn["align"] } : c)))}
              className="input-base"
              aria-label="Alignment"
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
            <select
              value={col.format || "text"}
              onChange={(e) => setColumns(columns.map((c, idx) => (idx === i ? { ...c, format: e.target.value as BlockColumn["format"] } : c)))}
              className="input-base"
              aria-label="Format"
            >
              {COLUMN_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <div className="flex items-center justify-center">
              <input
                type="checkbox"
                checked={Boolean(col.total)}
                onChange={(e) => setColumns(columns.map((c, idx) => (idx === i ? { ...c, total: e.target.checked } : c)))}
                aria-label="Sum this column"
                className="h-4 w-4 rounded border-[var(--border-strong)] text-brand-600"
              />
            </div>
            <Button variant="ghost" size="icon" onClick={() => setColumns(columns.filter((_, idx) => idx !== i))} aria-label="Remove column">
              <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setColumns([...columns, { key: "", label: "", width: 1 }])}>
          Add column
        </Button>
      </div>

      <SourceOrRows block={block} onChange={onChange} mode={mode} setMode={setMode}>
        <div className="space-y-2">
          <label className="block text-[13px] font-medium text-[var(--text)]">Rows</label>
          {rows.map((row, r) => (
            <div key={r} className="flex items-start gap-2">
              <div className="grid flex-1 gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))` }}>
                {columns.map((col) => (
                  <Input
                    key={col.key || "col"}
                    placeholder={col.label || col.key}
                    value={row[col.key] ?? ""}
                    onChange={(e) => setRows(rows.map((x, idx) => (idx === r ? { ...x, [col.key]: e.target.value } : x)))}
                  />
                ))}
              </div>
              <Button variant="ghost" size="icon" onClick={() => setRows(rows.filter((_, idx) => idx !== r))} aria-label="Remove row">
                <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} disabled={!columns.length} onClick={() => setRows([...rows, {}])}>
            Add row
          </Button>
          <p className="text-[12px] text-[var(--text-subtle)]">Cells can hold fields too: {"{{employee.designation}}"}.</p>
        </div>
      </SourceOrRows>

      <FieldGrid columns={3}>
        <Input label="Totals row label" placeholder="Total" value={block.totalsLabel || ""} onChange={(e) => onChange({ totalsLabel: e.target.value })} hint="Shown when any column is summed." />
        <Input label="When there are no rows" placeholder="Nothing to show" value={block.emptyText || ""} onChange={(e) => onChange({ emptyText: e.target.value })} />
        <Input label="Header colour" placeholder="#F3F4F6" value={block.headerColour || ""} onChange={(e) => onChange({ headerColour: e.target.value || null })} />
        <div className="col-span-3 flex flex-wrap gap-5">
          <Checkbox label="Shade alternate rows" checked={Boolean(block.zebra)} onChange={(e) => onChange({ zebra: e.target.checked })} />
          <Checkbox label="Number the rows" checked={Boolean(block.showIndex)} onChange={(e) => onChange({ showIndex: e.target.checked })} />
        </div>
      </FieldGrid>
    </div>
  );
}

function KeyValuesEditor({ block, onChange }: { block: TemplateBlock; onChange: (patch: Partial<TemplateBlock>) => void }) {
  const [mode, setMode] = useState<"source" | "rows">(block.source ? "source" : "rows");
  const rows = (block.rows || []) as Array<{ label: string; value: string }>;
  const setRows = (next: Array<{ label: string; value: string }>) => onChange({ rows: next });

  return (
    <div className="space-y-3.5">
      <SourceOrRows block={block} onChange={onChange} mode={mode} setMode={setMode}>
        <div className="space-y-2">
          <label className="block text-[13px] font-medium text-[var(--text)]">Pairs</label>
          {rows.map((row, i) => (
            <PairRow key={i} row={row} onChange={(next) => setRows(rows.map((x, idx) => (idx === i ? next : x)))} onRemove={() => setRows(rows.filter((_, idx) => idx !== i))} />
          ))}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRows([...rows, { label: "", value: "" }])}>
              Add pair
            </Button>
            <FieldPicker
              label="Add a field as a pair"
              onPick={(snippet) => {
                const path = snippet.replace(/^\{\{|\}\}$/g, "");
                const label = path.split(".").pop() || path;
                setRows([...rows, { label: label.replace(/([A-Z])/g, " $1").replace(/^\w/, (c) => c.toUpperCase()), value: snippet }]);
              }}
            />
          </div>
        </div>
      </SourceOrRows>

      <FieldGrid columns={2}>
        <Select
          label="Layout"
          value={block.layout || "double"}
          onChange={(e) => onChange({ layout: e.target.value as "double" | "single" })}
          options={[
            { value: "double", label: "Two pairs per line" },
            { value: "single", label: "One pair per line" },
          ]}
        />
        <div className="flex items-end pb-2">
          <Checkbox label="Label and value on one line" checked={Boolean(block.inline)} onChange={(e) => onChange({ inline: e.target.checked })} />
        </div>
      </FieldGrid>
    </div>
  );
}

function PairRow({ row, onChange, onRemove }: { row: { label: string; value: string }; onChange: (next: { label: string; value: string }) => void; onRemove: () => void }) {
  const valueRef = useRef<HTMLInputElement>(null);
  return (
    <div className="grid grid-cols-[1fr_1.4fr_auto_auto] items-center gap-2">
      <Input placeholder="Label" value={row.label} onChange={(e) => onChange({ ...row, label: e.target.value })} />
      <Input ref={valueRef} placeholder="Value or {{field}}" value={row.value} onChange={(e) => onChange({ ...row, value: e.target.value })} />
      <FieldPicker compact label="Field" targetRef={valueRef} value={row.value} onChange={(value) => onChange({ ...row, value })} />
      <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove pair">
        <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" />
      </Button>
    </div>
  );
}

function useImageUpload(templateId: string, onChange: (patch: Partial<TemplateBlock>) => void) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const loadPreview = async (fileId: string) => {
    try {
      const response = await fetch(`${BASE_URL}${API_PREFIX}/files/${fileId}/content`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${tokens.get()}` },
      });
      if (!response.ok) throw new Error("preview failed");
      setPreviewUrl(URL.createObjectURL(await response.blob()));
    } catch {
      // No preview is not a blocker — the fileId is still saved and renders in the PDF.
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("ownerType", "DocumentTemplate");
      formData.append("ownerId", templateId);
      formData.append("category", "attachment");
      const { data } = await api.upload<{ id: string }>("/files", formData);
      onChange({ fileId: data.id });
      await loadPreview(data.id);
      toast.success("Image uploaded");
    } catch (err) {
      toast.fromError(err, "Could not upload that image.");
    } finally {
      setUploading(false);
    }
  };

  return { uploading, previewUrl, upload, loadPreview };
}

function ImagePicker({
  fileId,
  templateId,
  onChange,
  emptyLabel,
}: {
  fileId: string | null | undefined;
  templateId: string;
  onChange: (patch: Partial<TemplateBlock>) => void;
  emptyLabel: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { uploading, previewUrl, upload } = useImageUpload(templateId, onChange);

  return (
    <div className="flex items-center gap-3">
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = "";
        }}
      />
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt="" className="h-16 w-28 rounded border object-contain" />
      ) : (
        <div className="grid h-16 w-28 place-items-center rounded border bg-[var(--surface-muted)] text-[var(--text-subtle)]">
          <ImageIcon className="h-5 w-5" aria-hidden />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Button variant="outline" size="sm" loading={uploading} icon={<Upload className="h-3.5 w-3.5" />} onClick={() => fileInput.current?.click()}>
          {fileId ? "Replace image" : emptyLabel}
        </Button>
        {fileId && (
          <Button variant="ghost" size="sm" onClick={() => onChange({ fileId: null })}>
            Remove image
          </Button>
        )}
      </div>
    </div>
  );
}

function ImageBlockEditor({ block, onChange, templateId }: { block: TemplateBlock; onChange: (patch: Partial<TemplateBlock>) => void; templateId: string }) {
  return (
    <div className="space-y-3">
      <ImagePicker fileId={block.fileId} templateId={templateId} onChange={onChange} emptyLabel="Upload image" />
      <FieldGrid columns={2}>
        <Input label="Height (px)" type="number" min={20} max={400} value={block.height ?? 100} onChange={(e) => onChange({ height: Number(e.target.value) })} />
        <Select
          label="Alignment"
          value={block.style?.align || "left"}
          onChange={(e) => onChange({ style: { ...block.style, align: e.target.value as "left" | "center" | "right" } })}
          options={[
            { value: "left", label: "Left" },
            { value: "center", label: "Center" },
            { value: "right", label: "Right" },
          ]}
        />
      </FieldGrid>
    </div>
  );
}

function SignatureEditor({ block, onChange, templateId }: { block: TemplateBlock; onChange: (patch: Partial<TemplateBlock>) => void; templateId: string }) {
  return (
    <div className="space-y-3">
      <FieldGrid columns={2}>
        <Input label="Label under the line" placeholder="Authorised Signatory" value={block.text || ""} onChange={(e) => onChange({ text: e.target.value })} />
        <Select
          label="Side of the page"
          value={block.align || "left"}
          onChange={(e) => onChange({ align: e.target.value as "left" | "right" })}
          options={[
            { value: "left", label: "Left" },
            { value: "right", label: "Right" },
          ]}
        />
      </FieldGrid>
      <div>
        <p className="mb-1.5 text-[13px] font-medium text-[var(--text)]">Signature or stamp image (optional)</p>
        <ImagePicker fileId={block.fileId} templateId={templateId} onChange={onChange} emptyLabel="Upload signature" />
      </div>
    </div>
  );
}
