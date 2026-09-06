"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, ClipboardList, Download, FileText, ShieldCheck, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatBytes } from "@/lib/files";
import { formatDate, formatRelative, humanise } from "@/lib/format";
import { Badge, Button, Callout, Card, Checkbox, EmptyState, Input, Modal, PageHeader, StatusBadge, Tabs, Textarea, useToast } from "@/components/ui";
import type { CompanyDocument, DocumentRequest, EmployeeDocument } from "@/lib/documentTemplateTypes";

/**
 * The employee's own documents: what HR shared, what HR asked for, and the
 * company policies they should read. Acknowledging is a typed name and a
 * tick — recorded with the time and address, and shown back to them.
 */
export default function MyDocumentsPage() {
  const { session } = useSession();
  const locale = session?.organization?.locale || "en-IN";
  const [tab, setTab] = useState("mine");

  const documents = useQuery({
    queryKey: ["me", "documents"],
    queryFn: async () => {
      const { data } = await api.get<EmployeeDocument[]>("/documents/me");
      return data;
    },
    enabled: Boolean(session?.employeeId),
  });

  const requests = useQuery({
    queryKey: ["me", "document-requests"],
    queryFn: async () => {
      const { data } = await api.get<DocumentRequest[]>("/documents/requests/me");
      return data;
    },
    enabled: Boolean(session?.employeeId),
  });

  const company = useQuery({
    queryKey: ["documents", "company", "mine"],
    queryFn: async () => {
      const { data } = await api.get<CompanyDocument[]>("/documents/company");
      return data;
    },
  });

  const pendingAcks = (documents.data || []).filter((d) => d.acknowledgement?.required && !d.acknowledgement.acknowledgedAt).length;
  const pendingCompany = (company.data || []).filter((d) => d.requireAcknowledgement && !d.acknowledged).length;
  const todo = pendingAcks + pendingCompany + (requests.data?.length || 0);

  return (
    <>
      <PageHeader title="My documents" description="Letters and certificates shared with you, anything HR has asked you to upload, and company policies." />

      {todo > 0 && (
        <Callout tone="warning" className="mb-5">
          You have {todo} thing{todo === 1 ? "" : "s"} to do here:
          {pendingAcks ? ` ${pendingAcks} document${pendingAcks === 1 ? "" : "s"} to acknowledge` : ""}
          {requests.data?.length ? `${pendingAcks ? "," : ""} ${requests.data.length} upload${requests.data.length === 1 ? "" : "s"} requested` : ""}
          {pendingCompany ? `${pendingAcks || requests.data?.length ? "," : ""} ${pendingCompany} polic${pendingCompany === 1 ? "y" : "ies"} to read` : ""}.
        </Callout>
      )}

      <Tabs
        items={[
          { key: "mine", label: "My documents", count: documents.data?.length },
          { key: "requests", label: "Requested from me", count: requests.data?.length },
          { key: "company", label: "Company documents", count: company.data?.length },
        ]}
        active={tab}
        onChange={setTab}
        className="mb-5"
      />

      {tab === "mine" && <MyDocuments documents={documents.data} isLoading={documents.isLoading} locale={locale} />}
      {tab === "requests" && <MyRequests requests={requests.data} isLoading={requests.isLoading} locale={locale} />}
      {tab === "company" && <CompanyDocuments documents={company.data} isLoading={company.isLoading} locale={locale} />}
    </>
  );
}

function MyDocuments({ documents, isLoading, locale }: { documents?: EmployeeDocument[]; isLoading: boolean; locale: string }) {
  const [acknowledging, setAcknowledging] = useState<EmployeeDocument | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-14" />
        ))}
      </div>
    );
  }
  if (!documents?.length) {
    return (
      <Card>
        <EmptyState icon={<FileText className="h-6 w-6" />} title="No documents yet" description="Offer letters, certificates and other documents shared with you appear here." />
      </Card>
    );
  }

  return (
    <>
      <Card padded={false}>
        <ul className="divide-y">
          {documents.map((document) => {
            const ack = document.acknowledgement;
            const needsAck = ack?.required && !ack.acknowledgedAt;
            return (
              <li key={document.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <FileText className="h-5 w-5 shrink-0 text-[var(--text-subtle)]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-[var(--text)]">{document.name}</p>
                  <p className="truncate text-[12.5px] text-[var(--text-muted)]">
                    {humanise(document.category)}
                    {document.documentNumber && ` · ${document.documentNumber}`}
                    {" · added "}
                    {formatRelative(document.createdAt)}
                    {document.expiresOn && ` · ${document.isExpired ? "expired" : "expires"} ${formatDate(document.expiresOn, { locale })}`}
                  </p>
                  {ack?.acknowledgedAt && (
                    <p className="flex items-center gap-1 text-[12px] text-[var(--success)]">
                      <CheckCircle2 className="h-3 w-3" aria-hidden />
                      You acknowledged this on {formatDate(ack.acknowledgedAt, { locale })}
                    </p>
                  )}
                  {document.status === "rejected" && document.rejectionReason && <p className="text-[12px] text-[var(--danger)]">Needs attention: {document.rejectionReason}</p>}
                </div>

                {needsAck && <Badge tone={ack.isOverdue ? "danger" : "warning"}>{ack.isOverdue ? "Acknowledgement overdue" : "Please acknowledge"}</Badge>}
                {document.status === "pending_review" && <StatusBadge status="pending_review" label="Being checked" />}
                {document.status === "rejected" && <StatusBadge status="rejected" />}
                {document.expiresOn && !document.isExpired && document.daysToExpiry !== null && document.daysToExpiry <= 30 && <StatusBadge status="pending" label={`${document.daysToExpiry} days left`} />}
                {document.isExpired && <StatusBadge status="expired" />}

                {document.file && (
                  <a href={api.fileUrl(document.file.downloadUrl)} className="inline-flex h-8 items-center gap-1.5 rounded-[calc(var(--radius)-2px)] border px-3 text-[13px] font-medium hover:bg-[var(--surface-muted)]">
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    Download
                  </a>
                )}
                {needsAck && (
                  <Button size="sm" icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={() => setAcknowledging(document)}>
                    Acknowledge
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {acknowledging && <AcknowledgeDialog title={acknowledging.name} path={`/documents/${acknowledging.id}/acknowledge`} fileUrl={acknowledging.file ? api.fileUrl(acknowledging.file.downloadUrl) : null} invalidate={[["me", "documents"]]} onClose={() => setAcknowledging(null)} />}
    </>
  );
}

function AcknowledgeDialog({ title, path, fileUrl, invalidate, onClose }: { title: string; path: string; fileUrl: string | null; invalidate: string[][]; onClose: () => void }) {
  const { session } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const user = session?.user as { firstName?: string; lastName?: string; name?: string } | undefined;
  const [name, setName] = useState(user?.name || [user?.firstName, user?.lastName].filter(Boolean).join(" "));
  const [read, setRead] = useState(false);

  const acknowledge = useMutation({
    mutationFn: () => api.post(path, { name }),
    onSuccess: () => {
      toast.success("Thank you", "Your acknowledgement has been recorded.");
      for (const key of invalidate) queryClient.invalidateQueries({ queryKey: key });
      onClose();
    },
    onError: (error) => toast.fromError(error, "Could not record your acknowledgement."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Acknowledge: ${title}`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Not now
          </Button>
          <Button loading={acknowledge.isPending} disabled={!read || !name.trim()} onClick={() => acknowledge.mutate()}>
            I acknowledge
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {fileUrl && (
          <a href={fileUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-brand-700 hover:underline">
            <Download className="h-3.5 w-3.5" aria-hidden />
            Open and read the document first
          </a>
        )}
        <Input label="Your full name" value={name} onChange={(e) => setName(e.target.value)} hint="Typed as your signature." />
        <Checkbox label="I have read and understood this document." checked={read} onChange={(e) => setRead(e.target.checked)} />
        <p className="text-[12px] text-[var(--text-subtle)]">The date, time and your name are recorded with the document.</p>
      </div>
    </Modal>
  );
}

function MyRequests({ requests, isLoading, locale }: { requests?: DocumentRequest[]; isLoading: boolean; locale: string }) {
  const [uploading, setUploading] = useState<DocumentRequest | null>(null);

  if (isLoading) return <div className="skeleton h-24" />;
  if (!requests?.length) {
    return (
      <Card>
        <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="Nothing requested" description="When HR needs a document from you — an ID proof, a certificate — it appears here with an upload button." />
      </Card>
    );
  }

  return (
    <>
      <Card padded={false}>
        <ul className="divide-y">
          {requests.map((request) => (
            <li key={request.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <ClipboardList className="h-5 w-5 shrink-0 text-[var(--text-subtle)]" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-[var(--text)]">{request.name}</p>
                <p className="text-[12.5px] text-[var(--text-muted)]">
                  {humanise(request.category)} · asked {formatRelative(request.createdAt)}
                  {request.requestedBy ? ` by ${request.requestedBy}` : ""}
                  {request.dueOn ? ` · due ${formatDate(request.dueOn, { locale })}` : ""}
                </p>
                {request.note && <p className="mt-0.5 text-[12.5px] text-[var(--text)]">{request.note}</p>}
              </div>
              {request.isOverdue && <Badge tone="danger">Overdue</Badge>}
              <Button size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => setUploading(request)}>
                Upload
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      {uploading && <UploadForRequestDialog request={uploading} onClose={() => setUploading(null)} />}
    </>
  );
}

function UploadForRequestDialog({ request, onClose }: { request: DocumentRequest; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [documentNumber, setDocumentNumber] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [notes, setNotes] = useState("");

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first.");
      const form = new FormData();
      form.append("file", file);
      form.append("requestId", request.id);
      if (documentNumber) form.append("documentNumber", documentNumber);
      if (expiresOn) form.append("expiresOn", expiresOn);
      if (notes) form.append("notes", notes);
      await api.upload("/documents/me", form);
    },
    onSuccess: () => {
      toast.success("Uploaded", "HR will check it and let you know.");
      queryClient.invalidateQueries({ queryKey: ["me", "document-requests"] });
      queryClient.invalidateQueries({ queryKey: ["me", "documents"] });
      onClose();
    },
    onError: (error) => toast.fromError(error, "Could not upload that file."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Upload: ${request.name}`}
      size="sm"
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
        <input ref={fileInput} type="file" className="hidden" accept="application/pdf,image/*,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <div className="flex items-center gap-3 rounded-md border border-dashed p-3">
          <Button variant="outline" size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => fileInput.current?.click()}>
            {file ? "Choose another" : "Choose a file"}
          </Button>
          <span className="truncate text-[12.5px] text-[var(--text-muted)]">{file ? `${file.name} · ${formatBytes(file.size)}` : "A clear scan or photo, or a PDF"}</span>
        </div>
        <Input label="Document number (if any)" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />
        <Input label="Expiry date (if any)" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        <Textarea label="Note to HR (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}

function CompanyDocuments({ documents, isLoading, locale }: { documents?: CompanyDocument[]; isLoading: boolean; locale: string }) {
  const [acknowledging, setAcknowledging] = useState<CompanyDocument | null>(null);

  if (isLoading) return <div className="skeleton h-24" />;
  if (!documents?.length) {
    return (
      <Card>
        <EmptyState icon={<BookOpen className="h-6 w-6" />} title="Nothing published yet" description="Company policies, the handbook and forms appear here once HR publishes them." />
      </Card>
    );
  }

  const groups = new Map<string, CompanyDocument[]>();
  for (const d of documents) {
    if (!groups.has(d.category)) groups.set(d.category, []);
    groups.get(d.category)!.push(d);
  }

  return (
    <>
      <div className="space-y-5">
        {[...groups.entries()].map(([category, rows]) => (
          <section key={category}>
            <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">{humanise(category)}</h2>
            <Card padded={false}>
              <ul className="divide-y">
                {rows.map((document) => (
                  <li key={document.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <BookOpen className="h-5 w-5 shrink-0 text-[var(--text-subtle)]" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-[var(--text)]">
                        {document.title} <span className="text-[12px] font-normal text-[var(--text-subtle)]">v{document.version}</span>
                      </p>
                      {document.description && <p className="text-[12.5px] text-[var(--text-muted)]">{document.description}</p>}
                      <p className="text-[12px] text-[var(--text-subtle)]">
                        {document.effectiveFrom ? `Effective ${formatDate(document.effectiveFrom, { locale })} · ` : ""}published {formatRelative(document.publishedAt)}
                      </p>
                      {document.acknowledged && document.acknowledgedAt && (
                        <p className="flex items-center gap-1 text-[12px] text-[var(--success)]">
                          <CheckCircle2 className="h-3 w-3" aria-hidden />
                          You acknowledged this on {formatDate(document.acknowledgedAt, { locale })}
                        </p>
                      )}
                    </div>
                    {document.requireAcknowledgement && !document.acknowledged && <Badge tone="warning">Please read and acknowledge</Badge>}
                    {document.file && (
                      <a href={api.fileUrl(document.file.downloadUrl)} className="inline-flex h-8 items-center gap-1.5 rounded-[calc(var(--radius)-2px)] border px-3 text-[13px] font-medium hover:bg-[var(--surface-muted)]">
                        <Download className="h-3.5 w-3.5" aria-hidden />
                        Open
                      </a>
                    )}
                    {document.requireAcknowledgement && !document.acknowledged && (
                      <Button size="sm" icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={() => setAcknowledging(document)}>
                        Acknowledge
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        ))}
      </div>
      {acknowledging && (
        <AcknowledgeDialog
          title={acknowledging.title}
          path={`/documents/company/${acknowledging.id}/acknowledge`}
          fileUrl={acknowledging.file ? api.fileUrl(acknowledging.file.downloadUrl) : null}
          invalidate={[["documents", "company"]]}
          onClose={() => setAcknowledging(null)}
        />
      )}
    </>
  );
}
