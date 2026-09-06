"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, Download, FileText, Pencil, Plus, Sparkles, Upload, Users } from "lucide-react";
import { api } from "@/lib/api";
import { readJsonFile, formatBytes } from "@/lib/files";
import { useSession } from "@/lib/session";
import { formatDate, formatRelative, humanise } from "@/lib/format";
import { Badge, Button, Card, EmptyState, NoAccessState, PageHeader, Tabs, useToast } from "@/components/ui";
import { BLANK_TEMPLATE, type BulkDownload, type DocumentTemplate } from "@/lib/documentTemplateTypes";
import { BulkGenerateDialog, GenerateDialog } from "@/components/documents/GenerateDialogs";
import { SheetsPanel } from "@/components/documents/SheetsPanel";
import { CompanyDocumentsPanel } from "@/components/documents/CompanyDocumentsPanel";
import { AcknowledgementsPanel, DocumentRequestsPanel } from "@/components/documents/RequestsAndAcknowledgements";

interface ExpiringDocument {
  _id: string;
  name: string;
  expiresOn: string;
  employeeId: { _id?: string; employeeCode: string; personal: { firstName: string; lastName: string } } | string;
}

/**
 * The documents hub: PDF templates, designable sheets, company policies,
 * requests, acknowledgements, expiries and bulk downloads — every tab is
 * permission-gated, so an HR executive without template rights sees only
 * what they can act on.
 */
export default function DocumentsPage() {
  const { session, can, canAny } = useSession();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const locale = session?.organization?.locale || "en-IN";
  const importInput = useRef<HTMLInputElement>(null);

  const tabs = [
    canAny("document.generate", "document.manage_templates") && { key: "templates", label: "Templates" },
    can("report.view") && { key: "sheets", label: "Sheets" },
    can("document.manage_company") && { key: "company", label: "Company documents" },
    can("document.view") && { key: "requests", label: "Requests" },
    can("document.view") && { key: "acknowledgements", label: "Acknowledgements" },
    can("document.view") && { key: "expiring", label: "Expiring" },
    can("document.generate") && { key: "bulk", label: "Bulk downloads" },
  ].filter(Boolean) as Array<{ key: string; label: string; count?: number }>;

  const [tab, setTab] = useState(tabs[0]?.key || "templates");
  const [generating, setGenerating] = useState<DocumentTemplate | null>(null);
  const [bulk, setBulk] = useState<DocumentTemplate | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["document-templates"],
    queryFn: async () => {
      const { data } = await api.get<DocumentTemplate[]>("/documents/templates");
      return data;
    },
    enabled: canAny("document.generate", "document.manage_templates"),
  });

  const { data: expiring } = useQuery({
    queryKey: ["documents", "expiring"],
    queryFn: async () => {
      const { data } = await api.get<ExpiringDocument[]>("/documents/expiring", { query: { withinDays: 60 } });
      return data;
    },
    enabled: can("document.view"),
  });

  const seed = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ created: number; total: number }>("/documents/templates/seed-defaults");
      return data;
    },
    onSuccess: (result) => {
      toast.success(result.created ? `${result.created} templates added` : "Nothing new to add", "Edit the wording to match your house style.");
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
    },
    onError: (error) => toast.fromError(error, "Could not add the default templates."),
  });

  const createBlank = useMutation({
    mutationFn: async () => {
      const code = `CUSTOM_${Date.now().toString(36).toUpperCase()}`;
      const { data } = await api.post<DocumentTemplate>("/documents/templates", { ...BLANK_TEMPLATE, code });
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      router.push(`/app/documents/templates/${data.id}`);
    },
    onError: (error) => toast.fromError(error, "Could not create a new template."),
  });

  const importTemplate = useMutation({
    mutationFn: async (file: File) => {
      const payload = await readJsonFile(file);
      const { data } = await api.post<DocumentTemplate>("/documents/templates/import", payload);
      return data;
    },
    onSuccess: (data) => {
      toast.success("Template imported", `${data.name} is ready to edit.`);
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      router.push(`/app/documents/templates/${data.id}`);
    },
    onError: (error) => toast.fromError(error, "That file could not be imported."),
  });

  if (!tabs.length) return <NoAccessState what="documents" />;

  const grouped = groupByCategory(templates || []);

  return (
    <>
      <PageHeader
        title="Documents"
        description="Letters and certificates from templates you design, spreadsheets in your own layout, and the policies everyone should have read."
        actions={
          tab === "templates" &&
          can("document.manage_templates") && (
            <>
              <input
                ref={importInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) importTemplate.mutate(file);
                  e.target.value = "";
                }}
              />
              <Button variant="outline" loading={seed.isPending} onClick={() => seed.mutate()} icon={<Sparkles className="h-4 w-4" />}>
                {templates?.length ? "Add missing starters" : "Add the starter templates"}
              </Button>
              <Button variant="outline" loading={importTemplate.isPending} onClick={() => importInput.current?.click()} icon={<Upload className="h-4 w-4" />}>
                Import
              </Button>
              <Button loading={createBlank.isPending} onClick={() => createBlank.mutate()} icon={<Plus className="h-4 w-4" />}>
                New template
              </Button>
            </>
          )
        }
      />

      <Tabs
        items={tabs.map((t) => (t.key === "templates" ? { ...t, count: templates?.length } : t.key === "expiring" ? { ...t, count: expiring?.length } : t))}
        active={tab}
        onChange={setTab}
        className="mb-5"
      />

      {tab === "templates" && (
        <>
          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((index) => (
                <div key={index} className="skeleton h-28" />
              ))}
            </div>
          ) : !templates?.length ? (
            <Card>
              <EmptyState
                icon={<FileText className="h-6 w-6" />}
                title="No templates yet"
                description="Start from our offer letters, appointment letters, experience and salary certificates, relieving letters, payslips and settlement statements, then rewrite them in your own words."
                action={can("document.manage_templates") ? <Button loading={seed.isPending} onClick={() => seed.mutate()}>Add the starter templates</Button> : undefined}
              />
            </Card>
          ) : (
            <div className="space-y-6">
              {grouped.map(([group, rows]) => (
                <section key={group}>
                  <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">{group}</h2>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {rows.map((template) => (
                      <Card key={template.id} className="flex flex-col">
                        <div className="flex items-start gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                            <FileText className="h-4.5 w-4.5" aria-hidden />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[14px] font-medium text-[var(--text)]">{template.name}</p>
                            <p className="truncate text-[12px] text-[var(--text-muted)]">
                              {humanise(template.category)} · {template.blocks?.length || 0} blocks
                              {template.numbering?.enabled ? ` · next ${template.numbering.prefix}${String(template.numbering.nextNumber).padStart(template.numbering.padding, "0")}` : ""}
                            </p>
                          </div>
                          {!template.isActive && <Badge tone="neutral">Inactive</Badge>}
                        </div>
                        {template.description && <p className="mt-2 line-clamp-2 text-[12.5px] text-[var(--text-muted)]">{template.description}</p>}
                        <div className="mt-4 flex gap-2">
                          {can("document.manage_templates") && (
                            <Button variant="outline" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => router.push(`/app/documents/templates/${template.id}`)}>
                              Edit
                            </Button>
                          )}
                          {can("document.generate") && template.isActive && (
                            <>
                              <Button variant="outline" size="sm" fullWidth onClick={() => setGenerating(template)}>
                                Generate
                              </Button>
                              {template.contextType !== "organization" && (
                                <Button variant="ghost" size="icon" aria-label="Generate for many employees" title="Generate for many employees" onClick={() => setBulk(template)}>
                                  <Users className="h-4 w-4" />
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "sheets" && <SheetsPanel />}
      {tab === "company" && <CompanyDocumentsPanel locale={locale} />}
      {tab === "requests" && <DocumentRequestsPanel locale={locale} />}
      {tab === "acknowledgements" && <AcknowledgementsPanel locale={locale} />}

      {tab === "expiring" && (
        <Card padded={false}>
          {!expiring?.length ? (
            <EmptyState title="Nothing expiring" description="Documents with an expiry date inside the next 60 days appear here. Employees are reminded automatically." />
          ) : (
            <ul className="divide-y">
              {expiring.map((document) => {
                const employee = typeof document.employeeId === "object" ? document.employeeId : null;
                const daysLeft = Math.ceil((new Date(document.expiresOn).getTime() - Date.now()) / 86400000);
                return (
                  <li key={document._id} className="flex items-center gap-3 px-5 py-3.5">
                    <AlertTriangle className={daysLeft <= 7 ? "h-4.5 w-4.5 shrink-0 text-[var(--danger)]" : "h-4.5 w-4.5 shrink-0 text-[var(--warning)]"} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-[var(--text)]">{document.name}</p>
                      <p className="truncate text-[12.5px] text-[var(--text-muted)]">
                        {employee ? (
                          <button type="button" className="hover:underline" onClick={() => employee._id && router.push(`/app/employees/${employee._id}`)}>
                            {[employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" ")} ({employee.employeeCode})
                          </button>
                        ) : (
                          "Unknown employee"
                        )}
                      </p>
                    </div>
                    <span className="shrink-0 text-[12.5px] text-[var(--text-muted)]">
                      {daysLeft <= 0 ? "Expired" : `${daysLeft} days`} · {formatDate(document.expiresOn, { locale })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === "bulk" && <BulkDownloadsPanel />}

      {generating && <GenerateDialog template={generating} onClose={() => setGenerating(null)} />}
      {bulk && <BulkGenerateDialog template={bulk} onClose={() => setBulk(null)} />}
    </>
  );
}

const GROUP_OF: Record<string, string> = {
  offer_letter: "Hiring", letter_of_intent: "Hiring", appointment_letter: "Hiring", joining_checklist: "Hiring",
  confirmation_letter: "Employment", probation_extension: "Employment", promotion_letter: "Employment", transfer_letter: "Employment",
  appraisal_letter: "Employment", contract_extension: "Employment", leave_approval: "Employment", id_card: "Employment",
  increment_letter: "Salary", salary_slip: "Salary", salary_certificate: "Salary", salary_annexure: "Salary",
  warning_letter: "Discipline", show_cause_notice: "Discipline", termination_letter: "Discipline",
  resignation_acceptance: "Exit", relieving_letter: "Exit", experience_certificate: "Exit", full_final_settlement: "Exit", exit_checklist: "Exit",
  bonafide_certificate: "Certificates", address_proof: "Certificates", no_objection_certificate: "Certificates",
  internship_certificate: "Certificates", training_certificate: "Certificates", attendance_report: "Other", custom: "Other",
};
const GROUP_ORDER = ["Hiring", "Employment", "Salary", "Certificates", "Discipline", "Exit", "Other"];

function groupByCategory(templates: DocumentTemplate[]) {
  const map = new Map<string, DocumentTemplate[]>();
  for (const t of templates) {
    const group = GROUP_OF[t.category] || "Other";
    if (!map.has(group)) map.set(group, []);
    map.get(group)!.push(t);
  }
  return GROUP_ORDER.filter((g) => map.has(g)).map((g) => [g, map.get(g)!] as const);
}

function BulkDownloadsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["documents", "bulk-downloads"],
    queryFn: async () => {
      const { data: rows } = await api.get<BulkDownload[]>("/documents/generate/bulk/downloads");
      return rows;
    },
    refetchInterval: 15_000,
  });

  if (isLoading) return <div className="skeleton h-32" />;

  return (
    <Card padded={false}>
      {!data?.length ? (
        <EmptyState icon={<Archive className="h-6 w-6" />} title="No bundles yet" description='Use "Generate for many" on a template — the zip of every letter lands here.' />
      ) : (
        <ul className="divide-y">
          {data.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <Archive className="h-4.5 w-4.5 shrink-0 text-[var(--text-subtle)]" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium text-[var(--text)]">{file.fileName}</p>
                <p className="text-[12.5px] text-[var(--text-muted)]">
                  {file.metadata?.count !== undefined ? `${file.metadata.count} document${file.metadata.count === 1 ? "" : "s"}` : ""}
                  {file.metadata?.failures ? ` · ${file.metadata.failures} failed` : ""}
                  {file.createdAt ? ` · ${formatRelative(file.createdAt)}` : ""}
                  {file.size ? ` · ${formatBytes(file.size)}` : ""}
                </p>
              </div>
              <a href={api.fileUrl(file.downloadUrl)} className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium hover:bg-[var(--surface-muted)]">
                <Download className="h-3.5 w-3.5" aria-hidden />
                Download
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
