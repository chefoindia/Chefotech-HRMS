"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, Download, Eye, EyeOff, FileText, MoreHorizontal, Pencil, Plus, ShieldCheck, Sparkles, Trash2, Upload, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatBytes } from "@/lib/files";
import { formatDate, formatRelative, humanise } from "@/lib/format";
import { Badge, Button, Callout, Card, CardHeader, Checkbox, ConfirmDialog, EmptyState, FieldGrid, Input, Modal, Select, StatusBadge, Switch, Textarea, useToast } from "@/components/ui";
import { DOCUMENT_CATEGORIES, type DocumentRequest, type DocumentTemplate, type EmployeeDocument } from "@/lib/documentTemplateTypes";
import { GenerateDialog } from "./GenerateDialogs";

/**
 * Everything HR does with one employee's documents: upload, generate from a
 * template, ask them to upload something, ask them to acknowledge
 * something, verify or reject what they uploaded, keep versions, and see
 * who acknowledged what and when.
 */
export function EmployeeDocumentsPanel({ employeeId, locale }: { employeeId: string; locale: string }) {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [uploading, setUploading] = useState<{ supersedes?: EmployeeDocument } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [reviewing, setReviewing] = useState<EmployeeDocument | null>(null);
  const [askingAck, setAskingAck] = useState<EmployeeDocument | null>(null);
  const [editing, setEditing] = useState<EmployeeDocument | null>(null);
  const [deleting, setDeleting] = useState<EmployeeDocument | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["employee", employeeId, "documents"],
    queryFn: async () => {
      const { data: documents } = await api.get<EmployeeDocument[]>(`/documents/employee/${employeeId}`);
      return documents;
    },
  });

  const { data: requests } = useQuery({
    queryKey: ["documents", "requests", { employeeId, status: "pending" }],
    queryFn: async () => {
      const { data: rows } = await api.get<DocumentRequest[]>("/documents/requests", { query: { employeeId, status: "pending", limit: 50 } });
      return rows;
    },
    enabled: can("document.view"),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["employee", employeeId, "documents"] });
    queryClient.invalidateQueries({ queryKey: ["documents"] });
  };

  const toggleVisibility = useMutation({
    mutationFn: (document: EmployeeDocument) => api.patch(`/documents/${document.id}`, { visibleToEmployee: !document.visibleToEmployee }),
    onSuccess: refresh,
    onError: (error) => toast.fromError(error, "Could not change visibility."),
  });

  const remove = useMutation({
    mutationFn: (document: EmployeeDocument) => api.delete(`/documents/${document.id}`),
    onSuccess: () => {
      toast.success("Document deleted");
      setDeleting(null);
      refresh();
    },
    onError: (error) => toast.fromError(error, "Could not delete that document."),
  });

  const cancelRequest = useMutation({
    mutationFn: (request: DocumentRequest) => api.post(`/documents/requests/${request.id}/cancel`),
    onSuccess: () => {
      toast.success("Request cancelled");
      refresh();
    },
    onError: (error) => toast.fromError(error, "Could not cancel that request."),
  });

  if (isLoading) return <div className="skeleton h-40" />;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Documents"
          description="Uploaded by HR or the employee, or generated from a template."
          action={
            <div className="flex flex-wrap gap-2">
              {can("document.upload") && (
                <Button variant="outline" size="sm" icon={<ClipboardList className="h-3.5 w-3.5" />} onClick={() => setRequesting(true)}>
                  Request a document
                </Button>
              )}
              {can("document.generate") && (
                <Button variant="outline" size="sm" icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => setGenerating(true)}>
                  Generate
                </Button>
              )}
              {can("document.upload") && (
                <Button size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => setUploading({})}>
                  Upload
                </Button>
              )}
            </div>
          }
        />

        {!data?.length ? (
          <EmptyState icon={<FileText className="h-5 w-5" />} title="No documents" description="Uploaded and generated documents appear here." className="mt-4" />
        ) : (
          <ul className="mt-4 divide-y">
            {data.map((document) => (
              <li key={document.id} className="flex flex-wrap items-center gap-3 py-3">
                <FileText className="h-4.5 w-4.5 shrink-0 text-[var(--text-subtle)]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-[var(--text)]">
                    {document.name}
                    {document.version > 1 && <span className="ml-1.5 text-[11.5px] text-[var(--text-subtle)]">v{document.version}</span>}
                  </p>
                  <p className="truncate text-[12px] text-[var(--text-muted)]">
                    {humanise(document.category)}
                    {document.documentNumber && ` · ${document.documentNumber}`}
                    {" · "}
                    {document.source === "generated" ? "generated" : document.source === "requested" ? "uploaded on request" : "uploaded"} {formatRelative(document.createdAt)}
                    {document.expiresOn && ` · ${document.isExpired ? "expired" : "expires"} ${formatDate(document.expiresOn, { locale })}`}
                    {document.file?.size ? ` · ${formatBytes(document.file.size)}` : ""}
                  </p>
                  <AcknowledgementLine document={document} locale={locale} />
                  {document.status === "rejected" && document.rejectionReason && <p className="text-[12px] text-[var(--danger)]">Rejected: {document.rejectionReason}</p>}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {!document.visibleToEmployee && (
                    <Badge tone="neutral">
                      <EyeOff className="mr-1 h-3 w-3" aria-hidden />
                      Hidden from employee
                    </Badge>
                  )}
                  <StatusBadge status={document.isExpired ? "expired" : document.status} />
                  {document.file && (
                    <a href={api.fileUrl(document.file.downloadUrl)} className="inline-flex h-8 w-8 items-center justify-center rounded-md border hover:bg-[var(--surface-muted)]" aria-label="Download" title="Download">
                      <Download className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  )}
                  <RowMenu
                    document={document}
                    onReview={can("document.view") && document.status === "pending_review" ? () => setReviewing(document) : undefined}
                    onAskAck={can("document.upload") && document.visibleToEmployee && !document.acknowledgement.acknowledgedAt ? () => setAskingAck(document) : undefined}
                    onEdit={can("document.upload") ? () => setEditing(document) : undefined}
                    onReplace={can("document.upload") && document.source !== "generated" ? () => setUploading({ supersedes: document }) : undefined}
                    onToggleVisibility={can("document.upload") ? () => toggleVisibility.mutate(document) : undefined}
                    onDelete={can("document.delete") ? () => setDeleting(document) : undefined}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {Boolean(requests?.length) && (
        <Card>
          <CardHeader title="Waiting on the employee" description="Documents HR has asked for that have not been uploaded yet." />
          <ul className="mt-3 divide-y">
            {requests!.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <ClipboardList className="h-4 w-4 shrink-0 text-[var(--text-subtle)]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-[var(--text)]">{request.name}</p>
                  <p className="text-[12px] text-[var(--text-muted)]">
                    {humanise(request.category)} · asked {formatRelative(request.createdAt)}
                    {request.requestedBy ? ` by ${request.requestedBy}` : ""}
                    {request.dueOn ? ` · due ${formatDate(request.dueOn, { locale })}` : ""}
                  </p>
                </div>
                {request.isOverdue && <Badge tone="danger">Overdue</Badge>}
                {can("document.upload") && (
                  <Button variant="ghost" size="sm" onClick={() => cancelRequest.mutate(request)}>
                    Cancel request
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {uploading && (
        <UploadDialog
          employeeId={employeeId}
          supersedes={uploading.supersedes}
          onClose={() => setUploading(null)}
          onDone={() => {
            setUploading(null);
            refresh();
          }}
        />
      )}
      {generating && <GenerateForEmployee employeeId={employeeId} onClose={() => setGenerating(false)} onDone={refresh} />}
      {requesting && (
        <RequestDialog
          employeeIds={[employeeId]}
          onClose={() => setRequesting(false)}
          onDone={() => {
            setRequesting(false);
            refresh();
          }}
        />
      )}
      {reviewing && (
        <ReviewDialog
          document={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            refresh();
          }}
        />
      )}
      {askingAck && (
        <AskAcknowledgementDialog
          document={askingAck}
          onClose={() => setAskingAck(null)}
          onDone={() => {
            setAskingAck(null);
            refresh();
          }}
        />
      )}
      {editing && (
        <EditDialog
          document={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
        }}
        loading={remove.isPending}
        tone="danger"
        title="Delete this document?"
        confirmLabel="Delete"
        message={deleting ? `${deleting.name} and its file are removed. This is recorded in the audit trail.` : ""}
      />
    </div>
  );
}

export function AcknowledgementLine({ document, locale }: { document: EmployeeDocument; locale: string }) {
  const ack = document.acknowledgement;
  if (!ack?.required) return null;
  if (ack.acknowledgedAt) {
    return (
      <p className="flex items-center gap-1 text-[12px] text-[var(--success)]">
        <CheckCircle2 className="h-3 w-3" aria-hidden />
        Acknowledged {formatDate(ack.acknowledgedAt, { locale })}
        {ack.acknowledgedName ? ` by ${ack.acknowledgedName}` : ""}
      </p>
    );
  }
  return (
    <p className={`text-[12px] ${ack.isOverdue ? "text-[var(--danger)]" : "text-[var(--warning)]"}`}>
      Acknowledgement {ack.isOverdue ? "overdue" : "pending"}
      {ack.dueOn ? ` · due ${formatDate(ack.dueOn, { locale })}` : ""}
      {ack.requestedAt ? ` · asked ${formatRelative(ack.requestedAt)}` : ""}
    </p>
  );
}

function RowMenu({
  document,
  onReview,
  onAskAck,
  onEdit,
  onReplace,
  onToggleVisibility,
  onDelete,
}: {
  document: EmployeeDocument;
  onReview?: () => void;
  onAskAck?: () => void;
  onEdit?: () => void;
  onReplace?: () => void;
  onToggleVisibility?: () => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const items = [
    onReview && { label: "Review (verify / reject)", icon: <ShieldCheck className="h-3.5 w-3.5" />, run: onReview },
    onAskAck && { label: document.acknowledgement.required ? "Send acknowledgement reminder" : "Ask to acknowledge", icon: <CheckCircle2 className="h-3.5 w-3.5" />, run: onAskAck },
    onEdit && { label: "Edit details", icon: <Pencil className="h-3.5 w-3.5" />, run: onEdit },
    onReplace && { label: "Upload a new version", icon: <Upload className="h-3.5 w-3.5" />, run: onReplace },
    onToggleVisibility && { label: document.visibleToEmployee ? "Hide from employee" : "Share with employee", icon: document.visibleToEmployee ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />, run: onToggleVisibility },
    onDelete && { label: "Delete", icon: <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" />, run: onDelete, danger: true },
  ].filter(Boolean) as Array<{ label: string; icon: React.ReactNode; run: () => void; danger?: boolean }>;

  if (!items.length) return null;

  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size="icon" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div role="menu" className="absolute right-0 z-40 mt-1 w-56 rounded-[var(--radius)] border bg-[var(--surface)] p-1 shadow-lg">
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
                className={`flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[13px] hover:bg-[var(--surface-muted)] ${item.danger ? "text-[var(--danger)]" : "text-[var(--text)]"}`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Dialogs ─────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: humanise(c) }));

function UploadDialog({ employeeId, supersedes, onClose, onDone }: { employeeId: string; supersedes?: EmployeeDocument; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(supersedes?.name || "");
  const [category, setCategory] = useState<string>(supersedes?.category || "other");
  const [documentNumber, setDocumentNumber] = useState(supersedes?.documentNumber || "");
  const [issuedOn, setIssuedOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [visible, setVisible] = useState(supersedes ? supersedes.visibleToEmployee : true);
  const [notes, setNotes] = useState("");

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first.");
      const form = new FormData();
      form.append("file", file);
      if (name) form.append("name", name);
      form.append("category", category);
      if (documentNumber) form.append("documentNumber", documentNumber);
      if (issuedOn) form.append("issuedOn", issuedOn);
      if (expiresOn) form.append("expiresOn", expiresOn);
      form.append("visibleToEmployee", visible ? "true" : "false");
      if (notes) form.append("notes", notes);
      if (supersedes) form.append("supersedesId", supersedes.id);
      await api.upload(`/documents/employee/${employeeId}`, form);
    },
    onSuccess: () => {
      toast.success(supersedes ? "New version uploaded" : "Document uploaded");
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not upload that document."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={supersedes ? `New version of ${supersedes.name}` : "Upload a document"}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={upload.isPending} disabled={!file} onClick={() => upload.mutate()}>
            Upload
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0] || null;
            setFile(picked);
            if (picked && !name) setName(picked.name.replace(/\.[^.]+$/, ""));
          }}
        />
        <div className="flex items-center gap-3 rounded-md border border-dashed p-3">
          <Button variant="outline" size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => fileInput.current?.click()}>
            {file ? "Choose another file" : "Choose a file"}
          </Button>
          <span className="truncate text-[12.5px] text-[var(--text-muted)]">{file ? `${file.name} · ${formatBytes(file.size)}` : "PDF, image or office document, up to 25 MB"}</span>
        </div>
        <FieldGrid columns={2}>
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. PAN card" />
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORY_OPTIONS} />
          <Input label="Document number (optional)" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />
          <Input label="Issued on" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
          <Input label="Expires on" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} hint="Reminders go out before expiry." />
        </FieldGrid>
        <Textarea label="Notes (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Switch label="Visible to the employee" checked={visible} onChange={setVisible} />
        {supersedes && <Callout tone="info">The previous version stays on file, marked as superseded.</Callout>}
      </div>
    </Modal>
  );
}

function GenerateForEmployee({ employeeId, onClose, onDone }: { employeeId: string; onClose: () => void; onDone: () => void }) {
  const [templateId, setTemplateId] = useState("");
  const { data: templates } = useQuery({
    queryKey: ["document-templates"],
    queryFn: async () => {
      const { data } = await api.get<DocumentTemplate[]>("/documents/templates");
      return data;
    },
  });
  const template = templates?.find((t) => t.id === templateId);
  const usable = (templates || []).filter((t) => t.isActive && t.contextType !== "leave_request" && t.contextType !== "payslip");

  if (template) return <GenerateDialog template={template} employeeId={employeeId} onClose={onClose} onDone={onDone} />;

  return (
    <Modal
      open
      onClose={onClose}
      title="Generate a document"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!templateId} onClick={() => undefined}>
            Next
          </Button>
        </>
      }
    >
      <Select
        label="Template"
        value={templateId}
        onChange={(e) => setTemplateId(e.target.value)}
        placeholder="Choose a template"
        options={usable.map((t) => ({ value: t.id, label: `${t.name} (${humanise(t.category)})` }))}
        hint={!usable.length ? "No active templates. Add the starter templates under Documents." : "Payslip and leave letters are generated from their own screens."}
      />
    </Modal>
  );
}

export function RequestDialog({ employeeIds, onClose, onDone, picker }: { employeeIds: string[]; onClose: () => void; onDone: () => void; picker?: React.ReactNode }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("identity");
  const [dueOn, setDueOn] = useState("");
  const [note, setNote] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ created: number }>("/documents/requests", { employeeIds, name, category, dueOn: dueOn || null, note });
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Requested from ${data.created} employee${data.created === 1 ? "" : "s"}`, "They have been notified and will see it under My documents.");
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not send that request."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Request a document"
      size={picker ? "lg" : "sm"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} disabled={!name.trim() || !employeeIds.length} onClick={() => create.mutate()}>
            Send request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {picker}
        <FieldGrid columns={2}>
          <Input label="What do you need?" placeholder="e.g. PAN card, degree certificate" value={name} onChange={(e) => setName(e.target.value)} required />
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORY_OPTIONS} />
          <Input label="Due by (optional)" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} hint="Reminders go out as the date approaches." />
        </FieldGrid>
        <Textarea label="Note to the employee (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Both sides, clearly readable." />
      </div>
    </Modal>
  );
}

function ReviewDialog({ document, onClose, onDone }: { document: EmployeeDocument; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const review = useMutation({
    mutationFn: (status: "verified" | "rejected") => api.post(`/documents/${document.id}/review`, { status, rejectionReason: status === "rejected" ? reason : undefined }),
    onSuccess: (_, status) => {
      toast.success(status === "verified" ? "Marked as verified" : "Rejected", "The employee has been told.");
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not record that review."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Review: ${document.name}`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="outline" icon={<XCircle className="h-3.5 w-3.5" />} loading={review.isPending} disabled={!reason.trim()} onClick={() => review.mutate("rejected")}>
            Reject
          </Button>
          <Button icon={<CheckCircle2 className="h-3.5 w-3.5" />} loading={review.isPending} onClick={() => review.mutate("verified")}>
            Verify
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {document.file && (
          <a href={api.fileUrl(document.file.downloadUrl)} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 hover:underline">
            <Download className="h-3.5 w-3.5" aria-hidden />
            Open the file
          </a>
        )}
        <Textarea label="If rejecting, why?" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The scan is cut off on the right." hint="Shown to the employee so they can fix it." />
      </div>
    </Modal>
  );
}

function AskAcknowledgementDialog({ document, onClose, onDone }: { document: EmployeeDocument; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [dueOn, setDueOn] = useState(document.acknowledgement.dueOn ? document.acknowledgement.dueOn.slice(0, 10) : "");
  const ask = useMutation({
    mutationFn: () => api.post(`/documents/${document.id}/request-acknowledgement`, { dueOn: dueOn || null }),
    onSuccess: () => {
      toast.success("Acknowledgement requested", "The employee has been notified.");
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not request an acknowledgement."),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Ask the employee to acknowledge"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={ask.isPending} onClick={() => ask.mutate()}>
            Send
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13.5px] text-[var(--text-muted)]">They will be asked to read {document.name} and confirm with their name. The confirmation is timestamped and kept with the document.</p>
        <Input label="Acknowledge by (optional)" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
      </div>
    </Modal>
  );
}

function EditDialog({ document, onClose, onDone }: { document: EmployeeDocument; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(document.name);
  const [category, setCategory] = useState<string>(document.category);
  const [documentNumber, setDocumentNumber] = useState(document.documentNumber || "");
  const [issuedOn, setIssuedOn] = useState(document.issuedOn ? document.issuedOn.slice(0, 10) : "");
  const [expiresOn, setExpiresOn] = useState(document.expiresOn ? document.expiresOn.slice(0, 10) : "");
  const [visible, setVisible] = useState(document.visibleToEmployee);
  const [notes, setNotes] = useState(document.notes || "");

  const save = useMutation({
    mutationFn: () => api.patch(`/documents/${document.id}`, { name, category, documentNumber, issuedOn: issuedOn || null, expiresOn: expiresOn || null, visibleToEmployee: visible, notes }),
    onSuccess: () => {
      toast.success("Saved");
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not save those details."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit document details"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FieldGrid columns={2}>
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORY_OPTIONS} />
          <Input label="Document number" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />
          <Input label="Issued on" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
          <Input label="Expires on" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        </FieldGrid>
        <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Checkbox label="Visible to the employee" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
        {document.verificationCode && (
          <p className="text-[12px] text-[var(--text-muted)]">
            Verification code: <span className="font-mono">{document.verificationCode}</span>
          </p>
        )}
      </div>
    </Modal>
  );
}

void Plus;
