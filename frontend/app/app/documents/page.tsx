"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Eye, FileText, Sparkles } from "lucide-react";
import { api, BASE_URL, API_PREFIX, tokens } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, humanise } from "@/lib/format";
import {
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  Modal,
  NoAccessState,
  PageHeader,
  Select,
  Tabs,
  useToast,
} from "@/components/ui";

interface Template {
  _id: string;
  name: string;
  code: string;
  category: string;
  contextType: string;
  isSystem: boolean;
  isActive: boolean;
}

interface ExpiringDocument {
  _id: string;
  name: string;
  expiresOn: string;
  employeeId: { employeeCode: string; personal: { firstName: string; lastName: string } } | string;
}

export default function DocumentsPage() {
  const { session, can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const locale = session?.organization?.locale || "en-IN";

  const [tab, setTab] = useState("templates");
  const [generating, setGenerating] = useState<Template | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["document-templates"],
    queryFn: async () => {
      const { data } = await api.get<Template[]>("/documents/templates");
      return data;
    },
    enabled: can("document.generate") || can("document.manage_templates"),
  });

  const { data: expiring } = useQuery({
    queryKey: ["documents", "expiring"],
    queryFn: async () => {
      const { data } = await api.get<ExpiringDocument[]>("/documents/expiring", {
        query: { withinDays: 60 },
      });
      return data;
    },
    enabled: can("document.view"),
  });

  const seed = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ created: number }>("/documents/templates/seed-defaults");
      return data;
    },
    onSuccess: (result) => {
      toast.success(`${result.created} templates added`, "Edit the wording to match your house style.");
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
    },
    onError: (error) => toast.fromError(error, "Could not add the default templates."),
  });

  if (!can("document.view") && !can("document.generate")) {
    return <NoAccessState what="documents" />;
  }

  return (
    <>
      <PageHeader
        title="Documents"
        description="Offer letters, certificates and payslips generated from templates you control."
        actions={
          can("document.manage_templates") &&
          !templates?.length && (
            <Button loading={seed.isPending} onClick={() => seed.mutate()} icon={<Sparkles className="h-4 w-4" />}>
              Add the starter templates
            </Button>
          )
        }
      />

      <Tabs
        items={[
          { key: "templates", label: "Templates", count: templates?.length },
          { key: "expiring", label: "Expiring soon", count: expiring?.length },
        ]}
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
                description="Start from our set of offer letters, experience certificates and payslips, then rewrite them in your own words."
                action={
                  can("document.manage_templates") ? (
                    <Button loading={seed.isPending} onClick={() => seed.mutate()}>
                      Add the starter templates
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((template) => (
                <Card key={template._id} className="flex flex-col">
                  <div className="flex items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                      <FileText className="h-4.5 w-4.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium text-[var(--text)]">
                        {template.name}
                      </p>
                      <p className="text-[12px] text-[var(--text-muted)]">
                        {humanise(template.category)}
                      </p>
                    </div>
                  </div>

                  {can("document.generate") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      fullWidth
                      onClick={() => setGenerating(template)}
                    >
                      Generate
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "expiring" && (
        <Card padded={false}>
          {!expiring?.length ? (
            <EmptyState
              title="Nothing expiring"
              description="Documents with an expiry date inside the next 60 days appear here."
            />
          ) : (
            <ul className="divide-y">
              {expiring.map((document) => {
                const employee =
                  typeof document.employeeId === "object" ? document.employeeId : null;
                const daysLeft = Math.ceil(
                  (new Date(document.expiresOn).getTime() - Date.now()) / 86400000
                );

                return (
                  <li key={document._id} className="flex items-center gap-3 px-5 py-3.5">
                    <AlertTriangle
                      className={
                        daysLeft <= 7
                          ? "h-4.5 w-4.5 shrink-0 text-[var(--danger)]"
                          : "h-4.5 w-4.5 shrink-0 text-[var(--warning)]"
                      }
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-[var(--text)]">
                        {document.name}
                      </p>
                      <p className="truncate text-[12.5px] text-[var(--text-muted)]">
                        {employee
                          ? `${[employee.personal.firstName, employee.personal.lastName]
                              .filter(Boolean)
                              .join(" ")} (${employee.employeeCode})`
                          : "Unknown employee"}
                      </p>
                    </div>
                    <span className="shrink-0 text-[12.5px] text-[var(--text-muted)]">
                      {daysLeft <= 0 ? "Expired" : `${daysLeft} days`} ·{" "}
                      {formatDate(document.expiresOn, { locale })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {generating && (
        <GenerateDialog template={generating} onClose={() => setGenerating(null)} />
      )}
    </>
  );
}

function GenerateDialog({ template, onClose }: { template: Template; onClose: () => void }) {
  const toast = useToast();
  const [employeeId, setEmployeeId] = useState("");

  const { data: employees } = useQuery({
    queryKey: ["employees", "picker"],
    queryFn: async () => {
      const { data } = await api.get<Array<{ id: string; fullName: string; employeeCode: string }>>(
        "/employees",
        { query: { limit: 200 } }
      );
      return data;
    },
  });

  const store = useMutation({
    mutationFn: async () => {
      await api.post("/documents/generate", { templateId: template._id, employeeId });
    },
    onSuccess: () => {
      toast.success("Document generated", "It has been attached to the employee's profile.");
      onClose();
    },
    onError: (error) => toast.fromError(error, "Could not generate that document."),
  });

  /**
   * Preview streams the PDF. The token has to travel in the request, so this
   * fetches with auth and opens the resulting blob rather than pointing a new
   * tab at a URL that would arrive unauthenticated.
   */
  const preview = async () => {
    try {
      const response = await fetch(`${BASE_URL}${API_PREFIX}/documents/generate/preview`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokens.get()}`,
        },
        body: JSON.stringify({ templateId: template._id, employeeId }),
      });

      if (!response.ok) throw new Error("Preview failed");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error("Could not render a preview", "Check that the employee has the data the template needs.");
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Generate: ${template.name}`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="outline" disabled={!employeeId} onClick={preview} icon={<Eye className="h-3.5 w-3.5" />}>
            Preview
          </Button>
          <Button loading={store.isPending} disabled={!employeeId} onClick={() => store.mutate()}>
            Generate and attach
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Callout tone="info">
          Generated documents are stored privately against the employee and are only reachable
          through an authenticated download — never a public link.
        </Callout>

        <Select
          label="Employee"
          value={employeeId}
          onChange={(event) => setEmployeeId(event.target.value)}
          options={(employees || []).map((employee) => ({
            value: employee.id,
            label: `${employee.fullName} (${employee.employeeCode})`,
          }))}
          placeholder="Choose an employee"
        />
      </div>
    </Modal>
  );
}
