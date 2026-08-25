"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, Plus, Save, Trash2 } from "lucide-react";
import { api, API_PREFIX, BASE_URL, tokens } from "@/lib/api";
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
  NoAccessState,
  PageHeader,
  PageLoader,
  Select,
  Switch,
  Textarea,
  useToast,
} from "@/components/ui";
import { BlockEditor } from "@/components/documents/BlockEditor";
import {
  BLOCK_LABELS,
  BLOCK_TYPES,
  CONTEXT_TYPES,
  TEMPLATE_CATEGORIES,
  blankBlock,
  type BlockType,
  type DocumentTemplate,
  type TemplateVariable,
} from "@/lib/documentTemplateTypes";

/**
 * The document template editor.
 *
 * Every field here maps to something `pdfRenderer.js` actually reads — there
 * is no field in this form the renderer would silently ignore, and no block
 * type an HR administrator could add that the renderer does not know how to
 * draw. The "Available fields" panel is generated live from a real
 * employee's data, not a static list, so it can never claim a placeholder
 * exists that the template context does not actually provide.
 */
export default function DocumentTemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<DocumentTemplate | null>(null);
  const [dirty, setDirty] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addingBlockType, setAddingBlockType] = useState<BlockType | "">("");
  const [previewEmployeeId, setPreviewEmployeeId] = useState("");

  const { data: template, isLoading } = useQuery({
    queryKey: ["document-template", id],
    queryFn: async () => {
      const { data } = await api.get<DocumentTemplate>(`/documents/templates/${id}`);
      return data;
    },
  });

  const needsEmployee = template?.contextType === "employee" || template?.contextType === "payslip";

  const { data: employees } = useQuery({
    queryKey: ["employees", "picker"],
    queryFn: async () => {
      const { data } = await api.get<Array<{ id: string; fullName: string; employeeCode: string }>>(
        "/employees",
        { query: { limit: 200 } }
      );
      return data;
    },
    enabled: Boolean(needsEmployee),
  });

  const { data: variables } = useQuery({
    queryKey: ["document-template", id, "variables"],
    queryFn: async () => {
      const { data } = await api.get<{ variables: TemplateVariable[]; note?: string }>(
        `/documents/templates/${id}/variables`
      );
      return data;
    },
  });

  useEffect(() => {
    if (template) setDraft(template);
  }, [template]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      const { code, isSystem, id: _id, ...body } = draft;
      const { data } = await api.patch<DocumentTemplate>(`/documents/templates/${id}`, body);
      return data;
    },
    onSuccess: (data) => {
      if (data) setDraft(data);
      setDirty(false);
      toast.success("Template saved");
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      queryClient.invalidateQueries({ queryKey: ["document-template", id] });
    },
    onError: (error) => toast.fromError(error, "Could not save this template."),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/documents/templates/${id}`),
    onSuccess: () => {
      toast.success("Template removed");
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      router.push("/app/documents");
    },
    onError: (error) => toast.fromError(error, "Could not remove this template."),
  });

  const duplicate = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      const { id: _id, isSystem, code, name, ...rest } = draft;
      const { data } = await api.post<DocumentTemplate>("/documents/templates", {
        ...rest,
        name: `${name} (copy)`,
        code: `${code}_COPY_${Date.now().toString(36).toUpperCase()}`,
      });
      return data;
    },
    onSuccess: (data) => {
      if (!data) return;
      toast.success("Duplicated", "You're editing the copy now.");
      router.push(`/app/documents/templates/${data.id}`);
    },
    onError: (error) => toast.fromError(error, "Could not duplicate this template."),
  });

  if (!can("document.manage_templates")) return <NoAccessState what="document templates" />;
  if (isLoading || !draft) return <PageLoader label="Loading template" />;

  const update = <K extends keyof DocumentTemplate>(key: K, value: DocumentTemplate[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setDirty(true);
  };
  const updateNested = <K extends "page" | "header" | "footer" | "watermark" | "numbering">(
    key: K,
    patch: Partial<DocumentTemplate[K]>
  ) => {
    setDraft((current) => (current ? { ...current, [key]: { ...current[key], ...patch } } : current));
    setDirty(true);
  };

  const setBlocks = (blocks: DocumentTemplate["blocks"]) => {
    setDraft((current) => (current ? { ...current, blocks } : current));
    setDirty(true);
  };

  const addBlock = () => {
    if (!addingBlockType) return;
    setBlocks([...draft.blocks, blankBlock(addingBlockType)]);
    setAddingBlockType("");
  };

  const preview = async () => {
    try {
      const response = await fetch(`${BASE_URL}${API_PREFIX}/documents/generate/preview`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens.get()}` },
        body: JSON.stringify({ templateId: id, employeeId: previewEmployeeId || undefined }),
      });
      if (!response.ok) throw new Error("preview failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error("Could not render a preview", "Add at least one active employee, then try again.");
    }
  };

  return (
    <>
      <PageHeader
        title={draft.name || "Untitled template"}
        description={draft.isSystem ? "One of the starter templates — edit it freely, it just cannot be deleted." : "Custom template"}
        actions={
          <>
            {needsEmployee && (
              <Select
                value={previewEmployeeId}
                onChange={(e) => setPreviewEmployeeId(e.target.value)}
                placeholder="Preview as…"
                options={(employees || []).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))}
                className="w-56"
              />
            )}
            <Button
              variant="outline"
              icon={<Eye className="h-4 w-4" />}
              disabled={needsEmployee && !previewEmployeeId}
              onClick={preview}
            >
              Preview
            </Button>
            <Button variant="outline" icon={<Copy className="h-4 w-4" />} loading={duplicate.isPending} onClick={() => duplicate.mutate()}>
              Duplicate
            </Button>
            {!draft.isSystem && (
              <Button variant="outline" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(true)}>
                Delete
              </Button>
            )}
            <Button icon={<Save className="h-4 w-4" />} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
              Save
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="About this template" />
            <div className="mt-4 space-y-4">
              <FieldGrid columns={2}>
                <Input label="Name" value={draft.name} onChange={(e) => update("name", e.target.value)} required />
                <Input label="Code" value={draft.code} disabled hint="Set once, when the template is created." />
              </FieldGrid>
              <Textarea
                label="Description"
                rows={2}
                value={draft.description || ""}
                onChange={(e) => update("description", e.target.value)}
              />
              <FieldGrid columns={2}>
                <Select
                  label="Category"
                  value={draft.category}
                  onChange={(e) => update("category", e.target.value as DocumentTemplate["category"])}
                  options={TEMPLATE_CATEGORIES.map((c) => ({ value: c, label: humanise(c) }))}
                />
                <Select
                  label="Uses data from"
                  value={draft.contextType}
                  onChange={(e) => update("contextType", e.target.value as DocumentTemplate["contextType"])}
                  options={CONTEXT_TYPES.map((c) => ({ value: c, label: humanise(c) }))}
                  hint="Which fields the Available fields panel offers."
                />
              </FieldGrid>
              <Switch
                label="Active"
                hint="Inactive templates stay saved but do not appear when generating a document."
                checked={draft.isActive}
                onChange={(v) => update("isActive", v)}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Content" description="What actually prints, top to bottom." />
            <div className="mt-4 space-y-3">
              {draft.blocks.length === 0 && (
                <p className="rounded-md border border-dashed p-4 text-center text-[13px] text-[var(--text-muted)]">
                  No content yet — add the first block below.
                </p>
              )}
              {draft.blocks.map((block, index) => (
                <BlockEditor
                  key={block._id || index}
                  block={block}
                  index={index}
                  total={draft.blocks.length}
                  templateId={id}
                  onChange={(patch) =>
                    setBlocks(draft.blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)))
                  }
                  onRemove={() => setBlocks(draft.blocks.filter((_, i) => i !== index))}
                  onMove={(direction) => {
                    const target = index + direction;
                    if (target < 0 || target >= draft.blocks.length) return;
                    const next = [...draft.blocks];
                    [next[index], next[target]] = [next[target], next[index]];
                    setBlocks(next);
                  }}
                />
              ))}

              <div className="flex items-end gap-2 border-t pt-3">
                <div className="flex-1">
                  <Select
                    value={addingBlockType}
                    onChange={(e) => setAddingBlockType(e.target.value as BlockType | "")}
                    placeholder="Choose a block type…"
                    options={BLOCK_TYPES.map((t) => ({ value: t, label: BLOCK_LABELS[t] }))}
                  />
                </div>
                <Button variant="outline" icon={<Plus className="h-4 w-4" />} disabled={!addingBlockType} onClick={addBlock}>
                  Add block
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Page setup" />
            <div className="mt-4 space-y-4">
              <FieldGrid columns={2}>
                <Select
                  label="Page size"
                  value={draft.page.size}
                  onChange={(e) => updateNested("page", { size: e.target.value as DocumentTemplate["page"]["size"] })}
                  options={[
                    { value: "A4", label: "A4" },
                    { value: "LETTER", label: "Letter" },
                    { value: "LEGAL", label: "Legal" },
                  ]}
                />
                <Select
                  label="Orientation"
                  value={draft.page.orientation}
                  onChange={(e) => updateNested("page", { orientation: e.target.value as DocumentTemplate["page"]["orientation"] })}
                  options={[
                    { value: "portrait", label: "Portrait" },
                    { value: "landscape", label: "Landscape" },
                  ]}
                />
              </FieldGrid>
              <FieldGrid columns={2}>
                {(["top", "bottom", "left", "right"] as const).map((side) => (
                  <Input
                    key={side}
                    label={`Margin — ${side}`}
                    type="number"
                    min={0}
                    max={200}
                    value={draft.page.margins[side]}
                    onChange={(e) =>
                      updateNested("page", { margins: { ...draft.page.margins, [side]: Number(e.target.value) } })
                    }
                  />
                ))}
              </FieldGrid>
            </div>
          </Card>

          <Card>
            <CardHeader title="Header" />
            <div className="mt-4 space-y-3">
              <Switch label="Show a header" checked={draft.header.enabled} onChange={(v) => updateNested("header", { enabled: v })} />
              {draft.header.enabled && (
                <>
                  <FieldGrid columns={3}>
                    <Checkbox label="Logo" checked={draft.header.showLogo} onChange={(e) => updateNested("header", { showLogo: e.target.checked })} />
                    <Checkbox
                      label="Company name"
                      checked={draft.header.showCompanyName}
                      onChange={(e) => updateNested("header", { showCompanyName: e.target.checked })}
                    />
                    <Checkbox label="Address" checked={draft.header.showAddress} onChange={(e) => updateNested("header", { showAddress: e.target.checked })} />
                  </FieldGrid>
                  <Input
                    label="Extra header text (optional)"
                    value={draft.header.text}
                    onChange={(e) => updateNested("header", { text: e.target.value })}
                    hint="Placeholders work here too."
                  />
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Footer" />
            <div className="mt-4 space-y-3">
              <Switch label="Show a footer" checked={draft.footer.enabled} onChange={(v) => updateNested("footer", { enabled: v })} />
              {draft.footer.enabled && (
                <>
                  <Input label="Footer text (optional)" value={draft.footer.text} onChange={(e) => updateNested("footer", { text: e.target.value })} />
                  <FieldGrid columns={2}>
                    <Checkbox
                      label="Page numbers"
                      checked={draft.footer.showPageNumbers}
                      onChange={(e) => updateNested("footer", { showPageNumbers: e.target.checked })}
                    />
                    <Checkbox
                      label={'"Generated on" date'}
                      checked={draft.footer.showGeneratedOn}
                      onChange={(e) => updateNested("footer", { showGeneratedOn: e.target.checked })}
                    />
                  </FieldGrid>
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Watermark" />
            <div className="mt-4 space-y-3">
              <Switch label="Show a watermark" checked={draft.watermark.enabled} onChange={(v) => updateNested("watermark", { enabled: v })} />
              {draft.watermark.enabled && (
                <FieldGrid columns={2}>
                  <Input label="Text" placeholder="CONFIDENTIAL" value={draft.watermark.text} onChange={(e) => updateNested("watermark", { text: e.target.value })} />
                  <Input
                    label="Opacity"
                    type="number"
                    min={0.01}
                    max={0.5}
                    step={0.01}
                    value={draft.watermark.opacity}
                    onChange={(e) => updateNested("watermark", { opacity: Number(e.target.value) })}
                  />
                </FieldGrid>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Document numbering" description={'e.g. "OL/2026/0007" on each generated offer letter.'} />
            <div className="mt-4 space-y-3">
              <Switch label="Number generated documents" checked={draft.numbering.enabled} onChange={(v) => updateNested("numbering", { enabled: v })} />
              {draft.numbering.enabled && (
                <FieldGrid columns={3}>
                  <Input label="Prefix" placeholder="OL/2026/" value={draft.numbering.prefix} onChange={(e) => updateNested("numbering", { prefix: e.target.value })} />
                  <Input
                    label="Next number"
                    type="number"
                    min={1}
                    value={draft.numbering.nextNumber}
                    onChange={(e) => updateNested("numbering", { nextNumber: Number(e.target.value) })}
                  />
                  <Input
                    label="Digits"
                    type="number"
                    min={1}
                    max={10}
                    value={draft.numbering.padding}
                    onChange={(e) => updateNested("numbering", { padding: Number(e.target.value) })}
                    hint="4 digits → 0007"
                  />
                </FieldGrid>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader title="Available fields" description="Copy one into any text, table or condition." />
            <div className="mt-3 max-h-[32rem] space-y-1 overflow-y-auto">
              {variables?.note && <Callout tone="info">{variables.note}</Callout>}
              {(variables?.variables || []).map((variable) => (
                <VariableRow key={variable.path} variable={variable} />
              ))}
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        tone="danger"
        title="Delete this template?"
        confirmLabel="Delete"
        message="Documents already generated from it are not affected — only future generation using this template stops."
      />
    </>
  );
}

function VariableRow({ variable }: { variable: TemplateVariable }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(variable.path).catch(() => undefined);
        toast.success("Copied", variable.path);
      }}
      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--surface-muted)]"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[11.5px] text-brand-700">{variable.path}</span>
        <span className="block truncate text-[11px] text-[var(--text-subtle)]">{variable.example || "—"}</span>
      </span>
      <Copy className="h-3 w-3 shrink-0 text-[var(--text-subtle)]" aria-hidden />
    </button>
  );
}

function humanise(value: string) {
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
