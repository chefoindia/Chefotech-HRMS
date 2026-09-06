"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Eye, History, Plus, RotateCcw, Save, Trash2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { openRendered } from "@/lib/files";
import { useSession } from "@/lib/session";
import { formatRelative, humanise } from "@/lib/format";
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
import { BlockEditor } from "@/components/documents/BlockEditor";
import { FieldPicker, VariablesProvider } from "@/components/documents/FieldPicker";
import { BulkGenerateDialog, GenerateDialog } from "@/components/documents/GenerateDialogs";
import { useEmployeeOptions } from "@/components/documents/EmployeePicker";
import {
  BLOCK_HINTS,
  BLOCK_LABELS,
  BLOCK_TYPES,
  CONTEXT_LABELS,
  CONTEXT_TYPES,
  DOCUMENT_CATEGORIES,
  TEMPLATE_CATEGORIES,
  blankBlock,
  type BlockType,
  type DocumentTemplate,
  type TemplateVariable,
  type TemplateVersion,
} from "@/lib/documentTemplateTypes";

/**
 * The document template designer.
 *
 * Every field here maps to something `pdfRenderer.js` actually reads, and
 * every block type it offers is one the renderer knows how to draw. The
 * "Available fields" list is generated live from a real employee's data, so
 * it can never claim a placeholder exists that the context does not supply.
 *
 * Each save keeps the previous state as a version; the Versions panel lets
 * an administrator get back to what a letter said last month.
 */
export default function DocumentTemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<DocumentTemplate | null>(null);
  const [dirty, setDirty] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [addingBlockType, setAddingBlockType] = useState<BlockType | "">("");
  const [previewEmployeeId, setPreviewEmployeeId] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [restoring, setRestoring] = useState<TemplateVersion | null>(null);

  const { data: template, isLoading } = useQuery({
    queryKey: ["document-template", id],
    queryFn: async () => {
      const { data } = await api.get<DocumentTemplate>(`/documents/templates/${id}`);
      return data;
    },
  });

  const needsEmployee = template ? template.contextType !== "organization" : false;
  const { employees } = useEmployeeOptions(Boolean(needsEmployee));

  const { data: variables } = useQuery({
    queryKey: ["document-template", id, "variables"],
    queryFn: async () => {
      const { data } = await api.get<{ variables: TemplateVariable[]; note?: string }>(`/documents/templates/${id}/variables`);
      return data;
    },
  });

  const { data: versions } = useQuery({
    queryKey: ["document-template", id, "versions"],
    queryFn: async () => {
      const { data } = await api.get<TemplateVersion[]>(`/documents/templates/${id}/versions`);
      return data;
    },
  });

  useEffect(() => {
    if (template) {
      setDraft(template);
      setDirty(false);
    }
  }, [template]);

  // Leaving with unsaved edits loses them; the browser asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["document-templates"] });
    queryClient.invalidateQueries({ queryKey: ["document-template", id] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return null;
      const { code, isSystem, id: _id, version, updatedAt, ...body } = draft;
      const { data } = await api.patch<DocumentTemplate>(`/documents/templates/${id}`, { ...body, changeNote: changeNote || undefined });
      return data;
    },
    onSuccess: (data) => {
      if (data) setDraft(data);
      setDirty(false);
      setChangeNote("");
      toast.success("Template saved", "The previous version is kept under Versions.");
      invalidate();
    },
    onError: (error) => toast.fromError(error, "Could not save this template."),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/documents/templates/${id}`),
    onSuccess: () => {
      toast.success(draft?.isSystem ? "Template deactivated" : "Template removed");
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      router.push("/app/documents");
    },
    onError: (error) => toast.fromError(error, "Could not remove this template."),
  });

  const duplicate = useMutation({
    mutationFn: async () => {
      if (!draft) return null;
      const { id: _id, isSystem, code, name, version, updatedAt, ...rest } = draft;
      const { data } = await api.post<DocumentTemplate>("/documents/templates", {
        ...rest,
        name: `${name} (copy)`,
        code: `${code}_COPY_${Date.now().toString(36).toUpperCase()}`.slice(0, 30),
      });
      return data;
    },
    onSuccess: (data) => {
      if (!data) return;
      toast.success("Duplicated", "You are editing the copy now.");
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      router.push(`/app/documents/templates/${data.id}`);
    },
    onError: (error) => toast.fromError(error, "Could not duplicate this template."),
  });

  const restore = useMutation({
    mutationFn: async (version: TemplateVersion) => {
      const { data } = await api.post<DocumentTemplate>(`/documents/templates/${id}/versions/${version.id}/restore`);
      return data;
    },
    onSuccess: (data) => {
      setDraft(data);
      setDirty(false);
      setRestoring(null);
      toast.success("Version restored", "The state before restoring is itself kept as a version.");
      invalidate();
    },
    onError: (error) => toast.fromError(error, "Could not restore that version."),
  });

  if (!can("document.manage_templates")) return <NoAccessState what="document templates" />;
  if (isLoading || !draft) return <PageLoader label="Loading template" />;

  const update = <K extends keyof DocumentTemplate>(key: K, value: DocumentTemplate[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setDirty(true);
  };
  const updateNested = <K extends "page" | "header" | "footer" | "watermark" | "numbering" | "storeAs">(key: K, patch: Partial<DocumentTemplate[K]>) => {
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
    setPreviewing(true);
    try {
      if (dirty) {
        toast.info("Previewing the saved version", "Save to see your latest edits in the preview.");
      }
      await openRendered("/documents/generate/preview", { templateId: id, employeeId: previewEmployeeId || undefined });
    } catch (error) {
      toast.fromError(error, "Could not render a preview. Add at least one active employee, then try again.");
    } finally {
      setPreviewing(false);
    }
  };

  const exportTemplate = async () => {
    try {
      await api.download(`/documents/templates/${id}/export`, undefined, `${draft.code.toLowerCase()}.template.json`);
    } catch (error) {
      toast.fromError(error, "Could not export this template.");
    }
  };

  return (
    <VariablesProvider variables={variables?.variables || []}>
      <PageHeader
        title={draft.name || "Untitled template"}
        description={
          <>
            {draft.isSystem ? "A starter template — edit it freely; it can be deactivated but not deleted." : "Custom template"} · version {draft.version}
            {dirty && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">unsaved changes</span>}
          </>
        }
        actions={
          <>
            {needsEmployee && (
              <Select
                value={previewEmployeeId}
                onChange={(e) => setPreviewEmployeeId(e.target.value)}
                placeholder="Preview as…"
                options={employees.map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))}
                className="w-56"
              />
            )}
            <Button variant="outline" icon={<Eye className="h-4 w-4" />} disabled={needsEmployee && !previewEmployeeId} loading={previewing} onClick={preview}>
              Preview
            </Button>
            {can("document.generate") && (
              <>
                <Button variant="outline" onClick={() => setGenerating(true)}>
                  Generate
                </Button>
                <Button variant="outline" icon={<Users className="h-4 w-4" />} onClick={() => setBulk(true)}>
                  For many
                </Button>
              </>
            )}
            <Button variant="outline" icon={<Copy className="h-4 w-4" />} loading={duplicate.isPending} onClick={() => duplicate.mutate()}>
              Duplicate
            </Button>
            <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportTemplate}>
              Export
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

      <div className="grid gap-5 lg:grid-cols-[1fr_21rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="About this template" />
            <div className="mt-4 space-y-4">
              <FieldGrid columns={2}>
                <Input label="Name" value={draft.name} onChange={(e) => update("name", e.target.value)} required />
                <Input label="Code" value={draft.code} disabled hint="Set once, when the template is created." />
              </FieldGrid>
              <Textarea label="Description" rows={2} value={draft.description || ""} onChange={(e) => update("description", e.target.value)} />
              <FieldGrid columns={2}>
                <Select
                  label="Category"
                  value={draft.category}
                  onChange={(e) => update("category", e.target.value as DocumentTemplate["category"])}
                  options={TEMPLATE_CATEGORIES.map((c) => ({ value: c, label: humanise(c) }))}
                  hint="Salary categories unlock the salary fields."
                />
                <Select
                  label="Renders for"
                  value={draft.contextType}
                  onChange={(e) => update("contextType", e.target.value as DocumentTemplate["contextType"])}
                  options={CONTEXT_TYPES.map((c) => ({ value: c, label: CONTEXT_LABELS[c] }))}
                  hint="What you pick when generating, and which fields exist."
                />
              </FieldGrid>
              <Switch label="Active" hint="Inactive templates stay saved but cannot be used to generate documents." checked={draft.isActive} onChange={(v) => update("isActive", v)} />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Content"
              description="What prints, top to bottom. Click a field name on the right, or use Insert field inside any text, to add live data."
            />
            <div className="mt-4 space-y-3">
              {draft.blocks.length === 0 && (
                <p className="rounded-md border border-dashed p-4 text-center text-[13px] text-[var(--text-muted)]">No content yet — add the first block below.</p>
              )}
              {draft.blocks.map((block, index) => (
                <BlockEditor
                  key={block._id || `${index}-${block.type}`}
                  block={block}
                  index={index}
                  total={draft.blocks.length}
                  templateId={id}
                  onChange={(patch) => setBlocks(draft.blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)))}
                  onRemove={() => setBlocks(draft.blocks.filter((_, i) => i !== index))}
                  onDuplicate={() => {
                    const { _id, ...copy } = draft.blocks[index];
                    const next = [...draft.blocks];
                    next.splice(index + 1, 0, JSON.parse(JSON.stringify(copy)));
                    setBlocks(next);
                  }}
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
                    options={BLOCK_TYPES.map((t) => ({ value: t, label: `${BLOCK_LABELS[t]} — ${BLOCK_HINTS[t]}` }))}
                  />
                </div>
                <Button variant="outline" icon={<Plus className="h-4 w-4" />} disabled={!addingBlockType} onClick={addBlock}>
                  Add block
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="When a document is generated" description="Where it lands in the employee's file, and what they are asked to do." />
            <div className="mt-4 space-y-3">
              <FieldGrid columns={2}>
                <Select
                  label="File it under"
                  value={draft.storeAs?.category || ""}
                  onChange={(e) => updateNested("storeAs", { category: (e.target.value || null) as DocumentTemplate["storeAs"]["category"] })}
                  placeholder="Decide from the category"
                  options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: humanise(c) }))}
                />
              </FieldGrid>
              <Switch label="Visible to the employee by default" hint="They are notified and can download it. Can be changed per document." checked={draft.storeAs?.visibleToEmployee !== false} onChange={(v) => updateNested("storeAs", { visibleToEmployee: v })} />
              <Switch label="Ask for acknowledgement by default" hint="Records a named, timestamped confirmation that they read it." checked={Boolean(draft.storeAs?.requireAcknowledgement)} onChange={(v) => updateNested("storeAs", { requireAcknowledgement: v })} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Header" />
            <div className="mt-4 space-y-3">
              <Switch label="Show a header" checked={draft.header.enabled} onChange={(v) => updateNested("header", { enabled: v })} />
              {draft.header.enabled && (
                <>
                  <Switch
                    label="Use the uploaded letterhead image"
                    hint="Upload one under Settings → Branding. It replaces the logo, name and address lines."
                    checked={Boolean(draft.header.useLetterhead)}
                    onChange={(v) => updateNested("header", { useLetterhead: v })}
                  />
                  {!draft.header.useLetterhead && (
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                      <Checkbox label="Logo" checked={draft.header.showLogo} onChange={(e) => updateNested("header", { showLogo: e.target.checked })} />
                      <Checkbox label="Company name" checked={draft.header.showCompanyName} onChange={(e) => updateNested("header", { showCompanyName: e.target.checked })} />
                      <Checkbox label="Address" checked={draft.header.showAddress} onChange={(e) => updateNested("header", { showAddress: e.target.checked })} />
                      <Checkbox label="Phone & email" checked={draft.header.showContact !== false} onChange={(e) => updateNested("header", { showContact: e.target.checked })} />
                    </div>
                  )}
                  <HeaderTextField value={draft.header.text} onChange={(text) => updateNested("header", { text })} />
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
                  <FieldGrid columns={3}>
                    <Checkbox label="Page numbers" checked={draft.footer.showPageNumbers} onChange={(e) => updateNested("footer", { showPageNumbers: e.target.checked })} />
                    <Checkbox label={'"Generated on" date'} checked={draft.footer.showGeneratedOn} onChange={(e) => updateNested("footer", { showGeneratedOn: e.target.checked })} />
                    <Checkbox
                      label="Verification QR and code"
                      checked={Boolean(draft.footer.showVerificationQr)}
                      onChange={(e) => updateNested("footer", { showVerificationQr: e.target.checked })}
                    />
                  </FieldGrid>
                  {draft.footer.showVerificationQr && (
                    <Callout tone="info">Anyone can scan the QR or type the code on the public verification page to confirm the document was issued by you and has not been altered. No personal details are shown there.</Callout>
                  )}
                </>
              )}
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
                    onChange={(e) => updateNested("page", { margins: { ...draft.page.margins, [side]: Number(e.target.value) } })}
                  />
                ))}
              </FieldGrid>
            </div>
          </Card>

          <Card>
            <CardHeader title="Watermark" />
            <div className="mt-4 space-y-3">
              <Switch label="Show a watermark" checked={draft.watermark.enabled} onChange={(v) => updateNested("watermark", { enabled: v })} />
              {draft.watermark.enabled && (
                <FieldGrid columns={2}>
                  <Input label="Text" placeholder="CONFIDENTIAL" value={draft.watermark.text} onChange={(e) => updateNested("watermark", { text: e.target.value })} />
                  <Input label="Opacity" type="number" min={0.01} max={0.5} step={0.01} value={draft.watermark.opacity} onChange={(e) => updateNested("watermark", { opacity: Number(e.target.value) })} />
                </FieldGrid>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Document numbering" description={'e.g. "OL/2026/0007" on each generated offer letter. Previews never consume a number.'} />
            <div className="mt-4 space-y-3">
              <Switch label="Number generated documents" checked={draft.numbering.enabled} onChange={(v) => updateNested("numbering", { enabled: v })} />
              {draft.numbering.enabled && (
                <FieldGrid columns={3}>
                  <Input label="Prefix" placeholder="OL/2026/" value={draft.numbering.prefix} onChange={(e) => updateNested("numbering", { prefix: e.target.value })} />
                  <Input label="Next number" type="number" min={1} value={draft.numbering.nextNumber} onChange={(e) => updateNested("numbering", { nextNumber: Number(e.target.value) })} />
                  <Input label="Digits" type="number" min={1} max={10} value={draft.numbering.padding} onChange={(e) => updateNested("numbering", { padding: Number(e.target.value) })} hint="4 digits → 0007" />
                </FieldGrid>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader title="Save" description="A note makes the version history readable." />
            <div className="mt-3 space-y-2">
              <Input placeholder="What changed? (optional)" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} />
              <Button fullWidth icon={<Save className="h-4 w-4" />} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
                {dirty ? "Save changes" : "Saved"}
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="Available fields" description="Click to copy. Every value comes from a real record." action={<FieldPicker compact label="Find" onPick={(snippet) => copy(snippet, toast)} />} />
            <div className="mt-3 max-h-[26rem] space-y-1 overflow-y-auto">
              {variables?.note && <Callout tone="info">{variables.note}</Callout>}
              {(variables?.variables || []).map((variable) => (
                <VariableRow key={variable.path} variable={variable} />
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Versions" description="Every save keeps the state before it." />
            <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
              {!versions?.length && <p className="text-[12.5px] text-[var(--text-muted)]">No earlier versions yet.</p>}
              {(versions || []).map((version) => (
                <div key={version.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--surface-muted)]">
                  <History className="h-3.5 w-3.5 shrink-0 text-[var(--text-subtle)]" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] text-[var(--text)]">
                      v{version.version}
                      {version.note ? ` — ${version.note}` : ""}
                    </p>
                    <p className="truncate text-[11px] text-[var(--text-subtle)]">
                      {formatRelative(version.createdAt)}
                      {version.changedBy ? ` · ${version.changedBy}` : ""} · {version.blockCount} block{version.blockCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={`Restore version ${version.version}`} onClick={() => setRestoring(version)}>
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </div>
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
        title={draft.isSystem ? "Deactivate this template?" : "Delete this template?"}
        confirmLabel={draft.isSystem ? "Deactivate" : "Delete"}
        message="Documents already generated from it are not affected — only future generation using this template stops."
      />

      <Modal
        open={Boolean(restoring)}
        onClose={() => setRestoring(null)}
        title={restoring ? `Restore version ${restoring.version}?` : ""}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setRestoring(null)}>
              Cancel
            </Button>
            <Button loading={restore.isPending} onClick={() => restoring && restore.mutate(restoring)}>
              Restore
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-[var(--text-muted)]">
          The template goes back to how it was {restoring ? formatRelative(restoring.createdAt) : ""}. The current state is kept as a new version, so nothing is lost
          {dirty ? " — except the edits you have not saved yet." : "."}
        </p>
      </Modal>

      {generating && <GenerateDialog template={draft} onClose={() => setGenerating(false)} />}
      {bulk && <BulkGenerateDialog template={draft} onClose={() => setBulk(false)} />}
    </VariablesProvider>
  );
}

function HeaderTextField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return <Input label="Extra header text (optional)" value={value} onChange={(e) => onChange(e.target.value)} hint="Placeholders work here too — {{company.taxId}}, for example." />;
}

function copy(text: string, toast: ReturnType<typeof useToast>) {
  navigator.clipboard.writeText(text).catch(() => undefined);
  toast.success("Copied", text);
}

function VariableRow({ variable }: { variable: TemplateVariable }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => copy(variable.path, toast)}
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
