"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Download, Pencil, Plus, Trash2, Upload, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useReferenceData } from "@/lib/hooks";
import { formatDate, formatRelative, humanise } from "@/lib/format";
import { formatBytes } from "@/lib/files";
import { Badge, Button, Callout, Card, Checkbox, ConfirmDialog, EmptyState, FieldGrid, Input, Modal, Select, Switch, Textarea, useToast } from "@/components/ui";
import { COMPANY_DOCUMENT_CATEGORIES, type CompanyDocument } from "@/lib/documentTemplateTypes";

/**
 * Company documents: the handbook, policies, forms and circulars every
 * employee (or a department, or a location) should be able to find — and,
 * when it matters, be on record as having read.
 */
export function CompanyDocumentsPanel({ locale }: { locale: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CompanyDocument | "new" | null>(null);
  const [report, setReport] = useState<CompanyDocument | null>(null);
  const [deleting, setDeleting] = useState<CompanyDocument | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["documents", "company", "manage"],
    queryFn: async () => {
      const { data: rows } = await api.get<CompanyDocument[]>("/documents/company", { query: { scope: "manage" } });
      return rows;
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["documents", "company"] });

  const remove = useMutation({
    mutationFn: (document: CompanyDocument) => api.delete(`/documents/company/${document.id}`),
    onSuccess: () => {
      toast.success("Document removed");
      setDeleting(null);
      refresh();
    },
    onError: (error) => toast.fromError(error, "Could not remove that document."),
  });

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>
          Publish a document
        </Button>
      </div>

      {isLoading ? (
        <div className="skeleton h-40" />
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={<BookOpen className="h-6 w-6" />}
            title="Nothing published yet"
            description="The employee handbook, leave policy, code of conduct, expense form — publish them here so everyone finds the current version in one place."
            action={<Button onClick={() => setEditing("new")}>Publish a document</Button>}
          />
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y">
            {data.map((document) => (
              <li key={document.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <BookOpen className="h-4.5 w-4.5 shrink-0 text-[var(--text-subtle)]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-[var(--text)]">
                    {document.title} <span className="text-[12px] font-normal text-[var(--text-subtle)]">v{document.version}</span>
                  </p>
                  <p className="truncate text-[12.5px] text-[var(--text-muted)]">
                    {humanise(document.category)} · {audienceLabel(document)} · published {formatRelative(document.publishedAt)}
                    {document.effectiveFrom ? ` · effective ${formatDate(document.effectiveFrom, { locale })}` : ""}
                    {document.file?.size ? ` · ${formatBytes(document.file.size)}` : ""}
                  </p>
                </div>
                {!document.isActive && <Badge tone="neutral">Unpublished</Badge>}
                {document.requireAcknowledgement && (
                  <button type="button" onClick={() => setReport(document)} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[12px] font-medium text-brand-700 hover:bg-brand-100">
                    <Users className="h-3 w-3" aria-hidden />
                    {document.acknowledgedCount} acknowledged
                  </button>
                )}
                {document.file && (
                  <a href={api.fileUrl(document.file.downloadUrl)} className="inline-flex h-8 w-8 items-center justify-center rounded-md border hover:bg-[var(--surface-muted)]" aria-label="Download">
                    <Download className="h-3.5 w-3.5" aria-hidden />
                  </a>
                )}
                <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => setEditing(document)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => setDeleting(document)}>
                  <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && (
        <CompanyDocumentDialog
          document={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {report && <AcknowledgementReport document={report} onClose={() => setReport(null)} locale={locale} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
        }}
        loading={remove.isPending}
        tone="danger"
        title="Remove this document?"
        confirmLabel="Remove"
        message={deleting ? `${deleting.title} disappears from every employee's company documents.` : ""}
      />
    </>
  );
}

function audienceLabel(document: CompanyDocument) {
  const a = document.audience || { type: "all" };
  if (a.type === "departments") return `${(a.departmentIds || []).length} department${(a.departmentIds || []).length === 1 ? "" : "s"}`;
  if (a.type === "locations") return `${(a.locationIds || []).length} location${(a.locationIds || []).length === 1 ? "" : "s"}`;
  return "everyone";
}

function CompanyDocumentDialog({ document, onClose, onDone }: { document: CompanyDocument | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { departments, locations } = useReferenceData();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(document?.title || "");
  const [description, setDescription] = useState(document?.description || "");
  const [category, setCategory] = useState<string>(document?.category || "policy");
  const [version, setVersion] = useState(document?.version || "1.0");
  const [effectiveFrom, setEffectiveFrom] = useState(document?.effectiveFrom ? document.effectiveFrom.slice(0, 10) : "");
  const [audience, setAudience] = useState<"all" | "departments" | "locations">(document?.audience?.type || "all");
  const [departmentIds, setDepartmentIds] = useState<string[]>(document?.audience?.departmentIds || []);
  const [locationIds, setLocationIds] = useState<string[]>(document?.audience?.locationIds || []);
  const [requireAck, setRequireAck] = useState(Boolean(document?.requireAcknowledgement));
  const [isActive, setIsActive] = useState(document ? document.isActive : true);

  const save = useMutation({
    mutationFn: async () => {
      if (!document) {
        if (!file) throw new Error("Choose a file first.");
        const form = new FormData();
        form.append("file", file);
        form.append("title", title);
        form.append("description", description);
        form.append("category", category);
        form.append("version", version);
        if (effectiveFrom) form.append("effectiveFrom", effectiveFrom);
        form.append("audience", audience);
        form.append("departmentIds", JSON.stringify(audience === "departments" ? departmentIds : []));
        form.append("locationIds", JSON.stringify(audience === "locations" ? locationIds : []));
        form.append("requireAcknowledgement", requireAck ? "true" : "false");
        form.append("isActive", isActive ? "true" : "false");
        await api.upload("/documents/company", form);
        return;
      }
      await api.patch(`/documents/company/${document.id}`, {
        title,
        description,
        category,
        version,
        effectiveFrom: effectiveFrom || null,
        audience,
        departmentIds: audience === "departments" ? departmentIds : [],
        locationIds: audience === "locations" ? locationIds : [],
        requireAcknowledgement: requireAck,
        isActive,
      });
      if (file) {
        const form = new FormData();
        form.append("file", file);
        await api.upload(`/documents/company/${document.id}/file`, form);
      }
    },
    onSuccess: () => {
      toast.success(document ? "Saved" : "Published", requireAck ? "Employees in the audience have been asked to acknowledge it." : undefined);
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not save that document."),
  });

  const toggle = (list: string[], id: string, set: (next: string[]) => void) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <Modal
      open
      onClose={onClose}
      title={document ? "Edit company document" : "Publish a company document"}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!title.trim() || (!document && !file)} onClick={() => save.mutate()}>
            {document ? "Save" : "Publish"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <input ref={fileInput} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <div className="flex items-center gap-3 rounded-md border border-dashed p-3">
          <Button variant="outline" size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => fileInput.current?.click()}>
            {file ? "Choose another file" : document ? "Replace the file" : "Choose a file"}
          </Button>
          <span className="truncate text-[12.5px] text-[var(--text-muted)]">
            {file ? `${file.name} · ${formatBytes(file.size)}` : document?.file ? `Current: ${document.file.fileName}` : "PDF or office document, up to 25 MB"}
          </span>
        </div>
        {document && file && <Callout tone="warning">Replacing the file starts acknowledgements over — everyone is asked to read the new version.</Callout>}
        <FieldGrid columns={2}>
          <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} options={COMPANY_DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: humanise(c) }))} />
          <Input label="Version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0" />
          <Input label="Effective from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </FieldGrid>
        <Textarea label="Description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One line on what it covers." />
        <Select
          label="Who should see it"
          value={audience}
          onChange={(e) => setAudience(e.target.value as typeof audience)}
          options={[
            { value: "all", label: "Everyone" },
            { value: "departments", label: "Specific departments" },
            { value: "locations", label: "Specific locations" },
          ]}
        />
        {audience === "departments" && (
          <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-md border p-2">
            {departments.map((d) => (
              <Checkbox key={d.id} label={d.name} checked={departmentIds.includes(d.id)} onChange={() => toggle(departmentIds, d.id, setDepartmentIds)} />
            ))}
          </div>
        )}
        {audience === "locations" && (
          <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-md border p-2">
            {locations.map((l) => (
              <Checkbox key={l.id} label={l.name} checked={locationIds.includes(l.id)} onChange={() => toggle(locationIds, l.id, setLocationIds)} />
            ))}
          </div>
        )}
        <Switch label="Ask everyone to acknowledge it" hint="Each person confirms they have read it; you can see who has not." checked={requireAck} onChange={setRequireAck} />
        <Switch label="Published" hint="Unpublished documents are hidden from employees but kept here." checked={isActive} onChange={setIsActive} />
      </div>
    </Modal>
  );
}

function AcknowledgementReport({ document, onClose, locale }: { document: CompanyDocument; onClose: () => void; locale: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["documents", "company", document.id, "acknowledgements"],
    queryFn: async () => {
      const { data: report } = await api.get<{ total: number; acknowledged: number; rows: Array<{ employeeId: string; name: string; hasAccount: boolean; acknowledged: boolean; acknowledgedAt: string | null }> }>(
        `/documents/company/${document.id}/acknowledgements`
      );
      return report;
    },
  });
  const [showAll, setShowAll] = useState(false);
  const rows = (data?.rows || []).filter((r) => showAll || !r.acknowledged);

  return (
    <Modal open onClose={onClose} title={`Who has read ${document.title}`} size="md" footer={<Button onClick={onClose}>Close</Button>}>
      {isLoading || !data ? (
        <div className="skeleton h-40" />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[13.5px] text-[var(--text)]">
              <strong>{data.acknowledged}</strong> of <strong>{data.total}</strong> acknowledged
            </p>
            <Checkbox label="Show everyone" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
            <div className="h-full bg-[var(--success)]" style={{ width: `${data.total ? Math.round((data.acknowledged / data.total) * 100) : 0}%` }} />
          </div>
          <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
            {rows.length === 0 && <li className="p-4 text-center text-[12.5px] text-[var(--text-muted)]">{showAll ? "Nobody is in the audience." : "Everyone has acknowledged it."}</li>}
            {rows.map((r) => (
              <li key={r.employeeId} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                <span className="flex-1 text-[var(--text)]">{r.name}</span>
                {r.acknowledged ? (
                  <span className="text-[12px] text-[var(--success)]">{formatDate(r.acknowledgedAt, { locale })}</span>
                ) : r.hasAccount ? (
                  <Badge tone="warning">Pending</Badge>
                ) : (
                  <Badge tone="neutral">No portal account</Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
