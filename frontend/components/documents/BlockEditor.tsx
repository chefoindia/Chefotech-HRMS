"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, ImageIcon, Plus, Trash2, Upload } from "lucide-react";
import { api, API_PREFIX, BASE_URL, tokens } from "@/lib/api";
import { Button, Checkbox, FieldGrid, Input, Select, Textarea, useToast } from "@/components/ui";
import { BLOCK_LABELS, type TemplateBlock } from "@/lib/documentTemplateTypes";

/**
 * One block in a document template, editable in place.
 *
 * The fields shown depend on the block's type — a spacer has a height, a
 * table has columns, a paragraph has style — because that mirrors exactly
 * what `pdfRenderer.js` actually reads for each type. Nothing here is a
 * field the renderer would silently ignore.
 */
export function BlockEditor({
  block,
  index,
  total,
  templateId,
  onChange,
  onRemove,
  onMove,
}: {
  block: TemplateBlock;
  index: number;
  total: number;
  templateId: string;
  onChange: (patch: Partial<TemplateBlock>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const style = block.style || {};

  const setStyle = (patch: Partial<NonNullable<TemplateBlock["style"]>>) =>
    onChange({ style: { ...style, ...patch } });

  return (
    <div className="rounded-[var(--radius)] border bg-[var(--surface)]">
      <div className="flex items-center gap-2 border-b bg-[var(--surface-muted)] px-3 py-2">
        <GripVertical className="h-4 w-4 shrink-0 text-[var(--text-subtle)]" aria-hidden />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="text-[13px] font-medium text-[var(--text)]">{BLOCK_LABELS[block.type]}</span>
          {!expanded && blockSummary(block) && (
            <span className="truncate text-[12px] text-[var(--text-subtle)]">— {blockSummary(block)}</span>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="icon" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Move down">
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove block">
            <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3.5 p-3.5">
          <BlockFields block={block} onChange={onChange} templateId={templateId} />

          {hasStyle(block.type) && (
            <FieldGrid columns={3}>
              <Input
                label="Font size"
                type="number"
                min={6}
                max={48}
                value={style.fontSize ?? ""}
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
              <Input
                label="Colour"
                placeholder="#1F2937"
                value={style.colour || ""}
                onChange={(e) => setStyle({ colour: e.target.value || null })}
              />
              {(block.type === "paragraph") && (
                <>
                  <Checkbox label="Bold" checked={Boolean(style.bold)} onChange={(e) => setStyle({ bold: e.target.checked })} />
                  <Checkbox label="Italic" checked={Boolean(style.italic)} onChange={(e) => setStyle({ italic: e.target.checked })} />
                </>
              )}
            </FieldGrid>
          )}

          <Input
            label="Only show when (optional)"
            placeholder="e.g. salary.ctcAnnual > 0"
            value={block.condition || ""}
            onChange={(e) => onChange({ condition: e.target.value || null })}
            hint="A formula using the same fields as the template. Left blank, the block always prints."
          />
        </div>
      )}
    </div>
  );
}

function hasStyle(type: TemplateBlock["type"]) {
  return ["heading", "paragraph", "list", "signature"].includes(type);
}

function blockSummary(block: TemplateBlock): string {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "signature":
      return block.text || "";
    case "list":
      return (block.items || []).join(", ");
    case "spacer":
      return `${block.height ?? 12}px`;
    case "table":
    case "key_values":
      return block.source || `${(block.rows || []).length} row(s)`;
    case "image":
      return block.fileId ? "image uploaded" : "no image yet";
    default:
      return "";
  }
}

function BlockFields({
  block,
  onChange,
  templateId,
}: {
  block: TemplateBlock;
  onChange: (patch: Partial<TemplateBlock>) => void;
  templateId: string;
}) {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return (
        <Textarea
          label="Text"
          rows={block.type === "paragraph" ? 4 : 2}
          value={block.text || ""}
          onChange={(e) => onChange({ text: e.target.value })}
          hint="Use {{employee.name}} style placeholders — see Available fields below."
        />
      );

    case "signature":
      return (
        <Input
          label="Label under the line"
          placeholder="Authorised Signatory"
          value={block.text || ""}
          onChange={(e) => onChange({ text: e.target.value })}
        />
      );

    case "list":
      return <ListItemsEditor block={block} onChange={onChange} />;

    case "spacer":
      return (
        <Input
          label="Height (px)"
          type="number"
          min={4}
          max={200}
          value={block.height ?? 12}
          onChange={(e) => onChange({ height: Number(e.target.value) })}
        />
      );

    case "divider":
      return <p className="text-[12.5px] text-[var(--text-muted)]">Draws a horizontal line. Nothing else to set.</p>;

    case "page_break":
      return <p className="text-[12.5px] text-[var(--text-muted)]">Everything after this starts on a new page.</p>;

    case "table":
      return <TableEditor block={block} onChange={onChange} />;

    case "key_values":
      return <KeyValuesEditor block={block} onChange={onChange} />;

    case "image":
      return <ImageBlockEditor block={block} onChange={onChange} templateId={templateId} />;

    default:
      return null;
  }
}

function ListItemsEditor({ block, onChange }: { block: TemplateBlock; onChange: (patch: Partial<TemplateBlock>) => void }) {
  const items = block.items || [];
  const set = (next: string[]) => onChange({ items: next });

  return (
    <div className="space-y-2">
      <label className="block text-[13px] font-medium text-[var(--text)]">List items</label>
      {items.map((item, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={item}
            onChange={(e) => set(items.map((v, idx) => (idx === i ? e.target.value : v)))}
            containerClassName="flex-1"
          />
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
  rowsHint,
}: {
  block: TemplateBlock;
  onChange: (patch: Partial<TemplateBlock>) => void;
  rowsHint: string;
}) {
  const [mode, setMode] = useState<"source" | "rows">(block.source ? "source" : "rows");
  const [rowsText, setRowsText] = useState(() => JSON.stringify(block.rows || [], null, 2));
  const [rowsError, setRowsError] = useState<string | null>(null);

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
          Pull from data
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("rows");
            onChange({ source: null });
          }}
          className={`flex-1 rounded px-2.5 py-1.5 text-[12.5px] font-medium ${mode === "rows" ? "bg-brand-600 text-white" : "text-[var(--text-muted)]"}`}
        >
          Type in the rows
        </button>
      </div>

      {mode === "source" ? (
        <Input
          label="Data field"
          placeholder="e.g. payslip.earnings"
          value={block.source || ""}
          onChange={(e) => onChange({ source: e.target.value })}
          hint="A field from Available fields below that holds a list — the payslip's earning lines, for example."
        />
      ) : (
        <Textarea
          label="Rows"
          rows={5}
          value={rowsText}
          onChange={(e) => {
            setRowsText(e.target.value);
            try {
              const parsed = JSON.parse(e.target.value);
              if (!Array.isArray(parsed)) throw new Error("must be a list");
              onChange({ rows: parsed });
              setRowsError(null);
            } catch {
              setRowsError("Not valid — each row goes inside [ ] as { } separated by commas.");
            }
          }}
          error={rowsError || undefined}
          hint={rowsError ? undefined : rowsHint}
          className="font-mono text-[12.5px]"
        />
      )}
    </div>
  );
}

function TableEditor({ block, onChange }: { block: TemplateBlock; onChange: (patch: Partial<TemplateBlock>) => void }) {
  const columns = block.columns || [];
  const setColumns = (next: typeof columns) => onChange({ columns: next });

  return (
    <div className="space-y-3.5">
      <div className="space-y-2">
        <label className="block text-[13px] font-medium text-[var(--text)]">Columns</label>
        {columns.map((col, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2">
            <Input
              placeholder="Field key, e.g. name"
              value={col.key}
              onChange={(e) => setColumns(columns.map((c, idx) => (idx === i ? { ...c, key: e.target.value } : c)))}
            />
            <Input
              placeholder="Column header"
              value={col.label}
              onChange={(e) => setColumns(columns.map((c, idx) => (idx === i ? { ...c, label: e.target.value } : c)))}
            />
            <select
              value={col.align || "left"}
              onChange={(e) => setColumns(columns.map((c, idx) => (idx === i ? { ...c, align: e.target.value as "left" | "center" | "right" } : c)))}
              className="input-base w-24"
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
            <Button variant="ghost" size="icon" onClick={() => setColumns(columns.filter((_, idx) => idx !== i))} aria-label="Remove column">
              <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setColumns([...columns, { key: "", label: "", width: 1 }])}
        >
          Add column
        </Button>
      </div>

      <SourceOrRows
        block={block}
        onChange={onChange}
        rowsHint='Each row is an object keyed by your column keys, e.g. [{"name": "Basic", "amount": "25,000"}]'
      />
    </div>
  );
}

function KeyValuesEditor({ block, onChange }: { block: TemplateBlock; onChange: (patch: Partial<TemplateBlock>) => void }) {
  return (
    <SourceOrRows
      block={block}
      onChange={onChange}
      rowsHint='Each row is a label and a value, e.g. [{"label": "PAN", "value": "{{employee.pan}}"}]'
    />
  );
}

function ImageBlockEditor({
  block,
  onChange,
  templateId,
}: {
  block: TemplateBlock;
  onChange: (patch: Partial<TemplateBlock>) => void;
  templateId: string;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const loadPreview = async (fileId: string) => {
    try {
      const response = await fetch(`${BASE_URL}${API_PREFIX}/files/${fileId}/content`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${tokens.get()}` },
      });
      if (!response.ok) throw new Error("preview failed");
      const blob = await response.blob();
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      // No preview is not a blocker — the fileId is still saved and will render in the PDF.
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

  return (
    <div className="space-y-3">
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = "";
        }}
      />

      <div className="flex items-center gap-3">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="h-16 w-28 rounded border object-contain" />
        ) : (
          <div className="grid h-16 w-28 place-items-center rounded border bg-[var(--surface-muted)] text-[var(--text-subtle)]">
            <ImageIcon className="h-5 w-5" aria-hidden />
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          loading={uploading}
          icon={<Upload className="h-3.5 w-3.5" />}
          onClick={() => fileInput.current?.click()}
        >
          {block.fileId ? "Replace image" : "Upload image"}
        </Button>
      </div>

      <FieldGrid columns={2}>
        <Input
          label="Height (px)"
          type="number"
          min={20}
          max={400}
          value={block.height ?? 100}
          onChange={(e) => onChange({ height: Number(e.target.value) })}
        />
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
